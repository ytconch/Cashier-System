const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB_PATH = path.resolve(ROOT, config.dbFile);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaSql = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
db.exec(schemaSql);

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

if (!hasColumn('orders', 'return_note')) {
  db.prepare(`ALTER TABLE orders ADD COLUMN return_note TEXT`).run();
}

const ensureProductionState = db.transaction(() => {
  const now = taipeiNow();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO production_state(component, prepared_count, sold_out, updated_at)
    VALUES (?, 0, 0, ?)
  `);
  insert.run('ramen', now);
  insert.run('haws', now);
});

ensureProductionState();

const ensureProductionInventory = db.transaction(() => {
  const now = taipeiNow();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO production_inventory(component, item_key, prepared_count, sold_out, updated_at)
    VALUES (?, ?, 0, 0, ?)
  `);
  insert.run('ramen', 'ramen', now);
  insert.run('haws', 'mix', now);
  insert.run('haws', 'grape', now);
  insert.run('haws', 'tomato', now);
});

ensureProductionInventory();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.get('/api/config', (req, res) => {
  res.json({
    prices: config.prices,
    ecoPolicy: config.ecoPolicy
  });
});


function taipeiNow(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date).replace(' ', 'T');
}

function dateKey(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function hourKey(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: config.timezone,
    hour: '2-digit',
    hour12: false
  }).format(date);
}

function minuteKey(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function parseIntSafe(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function json(res, status, payload) {
  return res.status(status).json(payload);
}

function getProductionState(component) {
  return db.prepare(`
    SELECT component, prepared_count, sold_out, updated_at
    FROM production_state
    WHERE component = ?
  `).get(component);
}

function listProductionState() {
  const rows = db.prepare(`
    SELECT component, prepared_count, sold_out, updated_at
    FROM production_state
    ORDER BY component ASC
  `).all();

  return rows.reduce((acc, row) => {
    acc[row.component] = row;
    return acc;
  }, {});
}

function getInventoryRow(component, itemKey) {
  return db.prepare(`
    SELECT component, item_key, prepared_count, sold_out, updated_at
    FROM production_inventory
    WHERE component = ? AND item_key = ?
  `).get(component, itemKey);
}

function listInventoryState() {
  const rows = db.prepare(`
    SELECT component, item_key, prepared_count, sold_out, updated_at
    FROM production_inventory
    ORDER BY component ASC, item_key ASC
  `).all();

  const state = {
    ramen: getInventoryRow('ramen', 'ramen'),
    haws: {
      types: {}
    }
  };

  for (const row of rows) {
    if (row.component === 'ramen') {
      state.ramen = row;
      continue;
    }

    if (row.component === 'haws') {
      state.haws.types[row.item_key] = row;
    }
  }

  state.haws.prepared_count = Object.values(state.haws.types).reduce((sum, row) => sum + row.prepared_count, 0);
  state.haws.sold_out = Object.values(state.haws.types).every((row) => row.sold_out === 1) ? 1 : 0;
  state.haws.updated_at = Object.values(state.haws.types).reduce((latest, row) => {
    if (!latest || row.updated_at > latest) return row.updated_at;
    return latest;
  }, null);

  return state;
}

function kitchenRoleFor(component) {
  return component === 'ramen' ? 'kitchen_ramen' : 'kitchen_haws';
}

function statusText(status) {
  return {
    waiting: '等待中',
    preparing: '製作中',
    ready: '已完成',
    picked_up: '已領取',
    canceled: '以取消',
    expired: '逾時領取'
  }[status] || status;
}

function roleLabel(role) {
  return config.users[role]?.label || role;
}

function publicUser(role) {
  const u = config.users[role];
  return u ? { role, username: u.username, label: u.label } : null;
}

function getOrderItems(orderId) {
  return db.prepare(`
    SELECT *
    FROM order_items
    WHERE order_id = ?
    ORDER BY id ASC
  `).all(orderId).map(row => ({
    ...row,
    options: JSON.parse(row.options_json || '{}')
  }));
}

function recalcOrderStats(orderId) {
  const items = getOrderItems(orderId);
  const totals = items.reduce((acc, item) => {
    acc.totalAmount += item.subtotal;
    acc.totalCost += item.cost_total;
    if (item.category === 'ramen') acc.ramen += item.qty;
    if (item.category === 'haws') acc.haws += item.qty;
    return acc;
  }, { totalAmount: 0, totalCost: 0, ramen: 0, haws: 0 });

  const profit = totals.totalAmount - totals.totalCost;
  db.prepare(`
    UPDATE orders
    SET ramen_required = ?,
        haws_required = ?,
        total_amount = ?,
        total_cost = ?,
        profit = ?
    WHERE id = ?
  `).run(totals.ramen, totals.haws, totals.totalAmount, totals.totalCost, profit, orderId);

  return totals;
}

function maybeSetReady(orderId) {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  if (!order) return;

  const ramenDone = order.ramen_required === 0 || order.ramen_done === 1;
  const hawsDone = order.haws_required === 0 || order.haws_done === 1;
  const nextStatus = (ramenDone && hawsDone) ? 'ready' : 'preparing';

  if (order.status !== nextStatus) {
    db.prepare(`
      UPDATE orders
      SET status = ?, return_note = CASE WHEN ? = 'ready' THEN NULL ELSE return_note END, updated_at = ?
      WHERE id = ?
    `).run(nextStatus, nextStatus, taipeiNow(), orderId);
    logStatus(orderId, order.status, nextStatus, '自動更新組別完成狀態');
  }
}

function logStatus(orderId, oldStatus, newStatus, reason = '') {
  db.prepare(`
    INSERT INTO order_status_log(order_id, old_status, new_status, reason, changed_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(orderId, oldStatus, newStatus, reason || null, taipeiNow());
}

function nextOrderNo() {
  // 不管日期，直接找整個資料庫裡最大的 order_no
  const row = db.prepare(`
    SELECT MAX(order_no) AS maxNo
    FROM orders
  `).get();

  // 如果資料庫是空的，從 1 開始
  if (!row || row.maxNo == null) {
    return 1;
  }
  
  // 直接在最大值上面 +1
  return Number(row.maxNo) + 1;
}

function buildHawsDisplay(options = {}) {
  const type = config.prices.haws.types[options.type] ? config.prices.haws.types[options.type].name : '混和';
  return `糖葫蘆｜${type}`;
}

function buildDrinkDisplay(key) {
  return config.prices.drinks.items[key]?.name || '飲料';
}
function buildRamenDisplay(options = {}) {
  const chickenLabel = { none: '不加入', add: '加入', double: '雙倍' }[options.chicken] || '不加入'
  const sauceLabel = config.prices.ramen.sauce[options.sauce]?.name || '醬油'
  const spicyLabel = options.spicy ? '加辣' : '不加辣'
  const ecoLabel = options.eco ? '有環保餐具' : '沒環保餐具'
  
  // 新增以下標籤判斷
  const cucumberLabel = options.cucumber ? '加小黃瓜' : '不加小黃瓜'
  const carrotLabel = options.carrot ? '加紅蘿蔔' : '不加紅蘿蔔'

  return `涼麵｜雞絲:${chickenLabel}｜醬料:${sauceLabel}｜辣:${spicyLabel}｜${cucumberLabel}｜${carrotLabel}｜${ecoLabel}`
}
function computeItemPricing(category, itemKey, qty, options) {
  qty = Math.max(1, parseIntSafe(qty, 1));

  if (category === 'ramen') {
    const chicken = config.prices.ramen.chicken[options.chicken] || config.prices.ramen.chicken.none;
    const sauce = config.prices.ramen.sauce[options.sauce] || config.prices.ramen.sauce.soy;
    const spicy = config.prices.ramen.spicy[options.spicy ? 'yes' : 'no'] || config.prices.ramen.spicy.no;
    const eco = config.prices.ramen.eco[options.eco ? 'yes' : 'no'] || config.prices.ramen.eco.no;

    const unitPrice =
      config.prices.ramen.basePrice +
      chicken.price +
      sauce.price +
      spicy.price +
      eco.price;

    const unitCost =
      config.prices.ramen.baseCost +
      chicken.cost +
      sauce.cost +
      spicy.cost +
      eco.cost;

    return {
      item_name: '涼麵',
      unit_price: unitPrice,
      unit_cost: unitCost,
      subtotal: unitPrice * qty,
      cost_total: unitCost * qty,
      display_text: buildRamenDisplay(options, qty)
    };
  }

  if (category === 'haws') {
    const info = config.prices.haws.types[itemKey];
    if (!info) throw new Error('不合法的糖葫蘆種類');
    return {
      item_name: info.name,
      unit_price: info.price,
      unit_cost: info.cost,
      subtotal: info.price * qty,
      cost_total: info.cost * qty,
      display_text: buildHawsDisplay({ type: itemKey })
    };
  }

  if (category === 'drink') {
    const info = config.prices.drinks.items[itemKey];
    if (!info) throw new Error('不合法的飲料');
    return {
      item_name: info.name,
      unit_price: info.price,
      unit_cost: info.cost,
      subtotal: info.price * qty,
      cost_total: info.cost * qty,
      display_text: info.name
    };
  }

  throw new Error(`不支援的品項類型：${category}`);
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('items 不能為空');

  return items.map((raw) => {
    const category = String(raw.category || '');
    const itemKey = String(raw.itemKey || raw.key || '');
    const qty = Math.max(1, parseIntSafe(raw.qty, 1));
    const options = raw.options && typeof raw.options === 'object' ? raw.options : {};

    if (category === 'ramen') {
      const p = computeItemPricing('ramen', 'ramen', qty, options);
      return {
        category,
        item_key: 'ramen',
        qty,
        options,
        ...p
      };
    }

    if (category === 'haws') {
      const p = computeItemPricing('haws', itemKey, qty, options);
      return {
        category,
        item_key: itemKey,
        qty,
        options,
        ...p
      };
    }

    if (category === 'drink') {
      const p = computeItemPricing('drink', itemKey, qty, options);
      return {
        category,
        item_key: itemKey,
        qty,
        options,
        ...p
      };
    }

    throw new Error(`不支援的品項類型：${category}`);
  });
}

function serializeOrder(order) {
  return {
    ...order,
    status_label: statusText(order.status),
    items: getOrderItems(order.id)
  };
}

function requireApiKey(req, res, next) {
  if (req.path.startsWith('/api/public/')) return next();
  if (req.path === '/api/login') return next();
  if (req.path.startsWith('/api/customer/')) return next();

  const key = req.headers['x-api-key'];
  if (!key || key !== config.systemKey) {
    return json(res, 403, { ok: false, message: '/api key 無效' });
  }
  next();
}

function requireSession(...allowedRoles) {
  return (req, res, next) => {
    if (req.path === '/api/login') return next();
    if (req.path.startsWith('/api/customer/')) return next();

    const token = req.headers['x-session-token'];
    if (!token) return json(res, 401, { ok: false, message: '未登入' });

    const session = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
    if (!session) return json(res, 401, { ok: false, message: '登入已過期' });

    if (new Date(session.expires_at).getTime() < Date.now()) {
      db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
      return json(res, 401, { ok: false, message: '登入已過期' });
    }

    req.session = session;
    if (allowedRoles.length && !allowedRoles.includes(session.role) && session.role !== 'admin') {
      return json(res, 403, { ok: false, message: '沒有權限' });
    }
    next();
  };
}

app.use(requireApiKey);
app.use(requireSession());

function refreshSession(token) {
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000);
  db.prepare(`UPDATE sessions SET expires_at = ? WHERE token = ?`).run(expires.toISOString(), token);
}

function createSession(role, username) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = new Date();
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000);
  db.prepare(`
    INSERT INTO sessions(token, role, username, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, role, username, now.toISOString(), expires.toISOString());
  return token;
}

function getBody(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function toOrderResponse(orderId) {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  return order ? serializeOrder(order) : null;
}

function expireReadyOrders() {
  const cutoff = new Date(Date.now() - config.autoExpireMinutes * 60 * 1000).toISOString();
  const orders = db.prepare(`
    SELECT id, status, updated_at
    FROM orders
    WHERE status = 'ready' AND updated_at <= ?
  `).all(cutoff);

  if (!orders.length) return;
  const tx = db.transaction((rows) => {
    const stmt = db.prepare(`UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ?`);
    for (const row of rows) {
      stmt.run(taipeiNow(), row.id);
      logStatus(row.id, row.status, 'expired', '系統自動逾時');
    }
  });
  tx(orders);
}

setInterval(expireReadyOrders, 60 * 1000);

app.get('/api/health', (_req, res) => json(res, 200, { ok: true, app: config.appName }));

app.get('/api/config', (req, res) => {
  json(res, 200, {
    ok: true,
    appName: config.appName,
    timezone: config.timezone,
    userList: Object.keys(config.users).map(publicUser),
    prices: config.prices
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = getBody(req);
  const found = Object.entries(config.users).find(([, u]) =>
    String(username || '') === u.username && String(password || '') === u.password
  );

  if (!found) return json(res, 401, { ok: false, message: '帳號或密碼錯誤' });

  const [role, user] = found;
  const token = createSession(role, user.username);

  json(res, 200, {
    ok: true,
    token,
    role,
    label: user.label,
    username: user.username
  });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  json(res, 200, { ok: true });
});

app.get('/api/me', (req, res) => {
  const session = req.session;
  json(res, 200, {
    ok: true,
    user: {
      role: session.role,
      username: session.username,
      label: roleLabel(session.role)
    }
  });
});

app.post('/api/orders', (req, res) => {
  try {
    const { items = [] } = getBody(req);
    const normalized = normalizeItems(items);
    const now = taipeiNow();
    const orderNo = nextOrderNo();
    const ramenQtyNeeded = normalized
      .filter((item) => item.category === 'ramen')
      .reduce((sum, item) => sum + item.qty, 0);
    const hawsQtyNeededByType = normalized
      .filter((item) => item.category === 'haws')
      .reduce((acc, item) => {
        acc[item.item_key] = (acc[item.item_key] || 0) + item.qty;
        return acc;
      }, {});
    const ramenInventory = getInventoryRow('ramen', 'ramen');

    if (ramenQtyNeeded > 0 && ramenInventory?.sold_out) {
      throw new Error('????????????????????');
    }

    for (const [itemKey, qty] of Object.entries(hawsQtyNeededByType)) {
      const inventory = getInventoryRow('haws', itemKey);
      if (qty > 0 && inventory?.sold_out) {
        const itemName = config.prices.haws.types[itemKey]?.name || itemKey;
        throw new Error(`${itemName} ?????????????????????`);
      }
    }

    const insertOrder = db.prepare(`
      INSERT INTO orders(order_no, status, pickup_state, ramen_required, haws_required, ramen_done, haws_done, total_amount, total_cost, profit, return_note, created_at, updated_at)
      VALUES (?, 'waiting', 'normal', 0, 0, 0, 0, 0, 0, 0, NULL, ?, ?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO order_items(order_id, category, item_key, item_name, qty, unit_price, unit_cost, subtotal, cost_total, options_json, display_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      const info = insertOrder.run(orderNo, now, now);
      const orderId = info.lastInsertRowid;
      let ramenCount = 0;
      let hawsCount = 0;
      let totalAmount = 0;
      let totalCost = 0;
      let ramenDone = 0;
      let hawsDone = 0;

      for (const item of normalized) {
        insertItem.run(
          orderId,
          item.category,
          item.item_key,
          item.item_name,
          item.qty,
          item.unit_price,
          item.unit_cost,
          item.subtotal,
          item.cost_total,
          JSON.stringify(item.options || {}),
          item.display_text,
          now
        );
        totalAmount += item.subtotal;
        totalCost += item.cost_total;
        if (item.category === 'ramen') ramenCount += item.qty;
        if (item.category === 'haws') hawsCount += item.qty;
      }

      const allHawsCovered = Object.entries(hawsQtyNeededByType).every(([itemKey, qty]) => {
        const inventory = getInventoryRow('haws', itemKey);
        return inventory && inventory.prepared_count >= qty;
      });

      if (hawsCount > 0 && allHawsCovered) {
        const deductHaws = db.prepare(`
          UPDATE production_inventory
          SET prepared_count = prepared_count - ?, updated_at = ?
          WHERE component = 'haws' AND item_key = ?
        `);

        for (const [itemKey, qty] of Object.entries(hawsQtyNeededByType)) {
          deductHaws.run(qty, now, itemKey);
        }
        hawsDone = 1;
      }

      const profit = totalAmount - totalCost;
      db.prepare(`
        UPDATE orders
        SET ramen_required = ?,
            haws_required = ?,
            ramen_done = ?,
            haws_done = ?,
            total_amount = ?,
            total_cost = ?,
            profit = ?
        WHERE id = ?
      `).run(ramenCount, hawsCount, ramenDone, hawsDone, totalAmount, totalCost, profit, orderId);

      logStatus(orderId, null, 'waiting', '????');

      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
      if (
        (order.ramen_required === 0 || order.ramen_done === 1) &&
        (order.haws_required === 0 || order.haws_done === 1)
      ) {
        db.prepare(`UPDATE orders SET status = 'ready', updated_at = ? WHERE id = ?`).run(now, orderId);
        logStatus(orderId, 'waiting', 'ready', '???????????');
      }

      return orderId;
    });

    const orderId = tx();
    json(res, 201, { ok: true, order: toOrderResponse(orderId) });
  } catch (err) {
    json(res, 400, { ok: false, message: err.message });
  }
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id);
  if (!order) return json(res, 404, { ok: false, message: '找不到訂單' });
  json(res, 200, { ok: true, order: serializeOrder(order) });
});

app.get('/api/orders', (req, res) => {
  const { role, status, q } = req.query;
  let sql = `SELECT * FROM orders`;
  const where = [];
  const params = [];

  if (status) {
    where.push(`status = ?`);
    params.push(status);
  }
  if (q) {
    where.push(`order_no LIKE ?`);
    params.push(`%${q}%`);
  }
  if (role === 'kitchen_ramen') {
    where.push(`ramen_required > 0 AND status IN ('waiting', 'preparing')`);
  } else if (role === 'kitchen_haws') {
    where.push(`haws_required > 0 AND status IN ('waiting', 'preparing')`);
  } else if (role === 'counter') {
    where.push(`status = 'ready'`);
  }

  if (where.length) sql += ` WHERE ` + where.join(' AND ');

  if (role === 'counter') {
    sql += ` ORDER BY CASE pickup_state WHEN 'unclaimed' THEN 1 ELSE 0 END ASC, created_at ASC`;
  } else {
    sql += ` ORDER BY created_at DESC`;
  }

  const orders = db.prepare(sql).all(...params).map(serializeOrder);
  json(res, 200, { ok: true, orders });
});

app.patch('/api/orders/:id/component', (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id);
  if (!order) return json(res, 404, { ok: false, message: '找不到訂單' });

  const { component, done } = getBody(req);
  if (!['ramen', 'haws'].includes(component)) {
    return json(res, 400, { ok: false, message: 'component 不合法' });
  }

  const flag = done ? 1 : 0;
  const field = component === 'ramen' ? 'ramen_done' : 'haws_done';
  db.prepare(`
    UPDATE orders
    SET ${field} = ?, updated_at = ?
    WHERE id = ?
  `).run(flag, taipeiNow(), order.id);

  const updatedBefore = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id);
  const oldStatus = updatedBefore.status;
  if (flag === 1) {
    if (component === 'ramen') {
      db.prepare(`UPDATE orders SET ramen_done = 1, return_note = CASE WHEN haws_required = 0 OR haws_done = 1 THEN NULL ELSE return_note END, status = CASE WHEN haws_required = 0 OR haws_done = 1 THEN 'ready' ELSE 'preparing' END, updated_at = ? WHERE id = ?`)
        .run(taipeiNow(), order.id);
    } else {
      db.prepare(`UPDATE orders SET haws_done = 1, return_note = CASE WHEN ramen_required = 0 OR ramen_done = 1 THEN NULL ELSE return_note END, status = CASE WHEN ramen_required = 0 OR ramen_done = 1 THEN 'ready' ELSE 'preparing' END, updated_at = ? WHERE id = ?`)
        .run(taipeiNow(), order.id);
    }
  } else {
    db.prepare(`UPDATE orders SET status = 'preparing', updated_at = ? WHERE id = ?`).run(taipeiNow(), order.id);
  }

  const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id);
  if (updated.status !== oldStatus) logStatus(order.id, oldStatus, updated.status, `${component} 組更新`);

  maybeSetReady(order.id);
  json(res, 200, { ok: true, order: serializeOrder(db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id)) });
});

app.patch('/api/orders/:id/status', (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id);
  if (!order) return json(res, 404, { ok: false, message: '找不到訂單' });

  const { status, pickup_state } = getBody(req);
  const allow = new Set(['waiting', 'preparing', 'ready', 'picked_up', 'canceled', 'expired']);
  const current = order.status;
  let nextStatus = order.status;
  let nextPickup = order.pickup_state;

  if (status != null) {
    if (!allow.has(status)) return json(res, 400, { ok: false, message: 'status 不合法' });
    if (status === 'ready') {
      if (!((order.ramen_required === 0 || order.ramen_done === 1) && (order.haws_required === 0 || order.haws_done === 1))) {
        return json(res, 400, { ok: false, message: '尚未全部完成，不能設為已完成/以領取' });
      }
    }
    nextStatus = status;
  }

  if (pickup_state != null) {
    if (!['normal', 'unclaimed'].includes(pickup_state)) {
      return json(res, 400, { ok: false, message: 'pickup_state 不合法' });
    }
    nextPickup = pickup_state;
  }

  db.prepare(`UPDATE orders SET status = ?, pickup_state = ?, updated_at = ? WHERE id = ?`)
    .run(nextStatus, nextPickup, taipeiNow(), order.id);

  if (nextStatus !== current) {
    logStatus(order.id, current, nextStatus, '人工更新');
  }

  json(res, 200, { ok: true, order: serializeOrder(db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id)) });
});

app.post('/api/orders/:id/cancel', (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id);
  if (!order) return json(res, 404, { ok: false, message: '找不到訂單' });

  db.prepare(`UPDATE orders SET status = 'canceled', updated_at = ? WHERE id = ?`).run(taipeiNow(), order.id);
  logStatus(order.id, order.status, 'canceled', '人工取消');
  json(res, 200, { ok: true, order: serializeOrder(db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id)) });
});
// 刪除訂單 API (建議僅限 admin 或 finance 權限)
app.delete('/api/orders/:id', requireSession('admin', 'finance'), (req, res) => {
  const { id } = req.params
  try {
    // 1. 先確認訂單是否存在
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id)
    if (!order) {
      return json(res, 404, { ok: false, message: '找不到該訂單' })
    }

    // 2. 使用交易 (Transaction) 確保資料完整性
    // 同時刪除訂單主表、品項明細與狀態日誌
    const deleteTx = db.transaction(() => {
      db.prepare(`DELETE FROM order_items WHERE order_id = ?`).run(id)
      db.prepare(`DELETE FROM order_status_log WHERE order_id = ?`).run(id)
      db.prepare(`DELETE FROM orders WHERE id = ?`).run(id)
    })

    deleteTx()

    console.log(`[系統] 訂單 ID ${id} (編號 #${order.order_no}) 已由 ${req.session.username} 刪除`)
    
    json(res, 200, { 
      ok: true, 
      message: `訂單 #${order.order_no} 已從系統移除` 
    })
  } catch (err) {
    console.error('刪除訂單失敗:', err)
    json(res, 500, { ok: false, message: '伺服器刪除過程中發生錯誤' })
  }
})

app.get('/api/customer/:orderNo', (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE order_no = ?`).get(parseIntSafe(req.params.orderNo, -1));
  if (!order) return json(res, 404, { ok: false, message: '找不到訂單' });
  json(res, 200, { ok: true, order: serializeOrder(order) });
});

app.get('/api/dashboard/summary', (req, res) => {
  const today = dateKey();
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_orders,
      COALESCE(SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END), 0) AS waiting_count,
      COALESCE(SUM(CASE WHEN status = 'preparing' THEN 1 ELSE 0 END), 0) AS preparing_count,
      COALESCE(SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END), 0) AS ready_count,
      COALESCE(SUM(CASE WHEN status = 'picked_up' THEN 1 ELSE 0 END), 0) AS picked_up_count,
      COALESCE(SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END), 0) AS canceled_count,
      COALESCE(SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0) AS expired_count,
      COALESCE(SUM(total_amount), 0) AS revenue,
      COALESCE(SUM(total_cost), 0) AS cost,
      COALESCE(SUM(profit), 0) AS profit
    FROM orders
  `).get();

  const todayRow = db.prepare(`
    SELECT
      COUNT(*) AS orders,
      COALESCE(SUM(total_amount), 0) AS revenue,
      COALESCE(SUM(total_cost), 0) AS cost,
      COALESCE(SUM(profit), 0) AS profit
    FROM orders
    WHERE created_at LIKE ?
  `).get(`${today}%`);

  json(res, 200, {
    ok: true,
    summary: {
      ...totals,
      today_orders: todayRow.orders,
      today_revenue: todayRow.revenue,
      today_cost: todayRow.cost,
      today_profit: todayRow.profit
    }
  });
});

app.get('/api/reports/hourly', (req, res) => {
  const days = Math.max(1, Math.min(30, parseIntSafe(req.query.days, 7)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT strftime('%H', created_at) AS hour,
           COUNT(*) AS orders,
           COALESCE(SUM(total_amount), 0) AS revenue,
           COALESCE(SUM(profit), 0) AS profit
    FROM orders
    WHERE created_at >= ?
    GROUP BY hour
    ORDER BY hour ASC
  `).all(since);

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const map = new Map(rows.map(r => [r.hour, r]));
  const data = hours.map(h => {
    const r = map.get(h) || { hour: h, orders: 0, revenue: 0, profit: 0 };
    return r;
  });
  json(res, 200, { ok: true, data });
});

app.get('/api/reports/daily', (req, res) => {
  const days = Math.max(3, Math.min(30, parseIntSafe(req.query.days, 7)));
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day,
           COUNT(*) AS orders,
           COALESCE(SUM(total_amount), 0) AS revenue,
           COALESCE(SUM(total_cost), 0) AS cost,
           COALESCE(SUM(profit), 0) AS profit
    FROM orders
    WHERE created_at >= ?
    GROUP BY day
    ORDER BY day ASC
  `).all(start);
  json(res, 200, { ok: true, data: rows });
});

app.get('/api/reports/menu', (req, res) => {
  const rows = db.prepare(`
    SELECT category, item_key, item_name,
           SUM(qty) AS qty,
           SUM(subtotal) AS revenue,
           SUM(cost_total) AS cost,
           SUM(subtotal - cost_total) AS profit
    FROM order_items
    GROUP BY category, item_key, item_name
    ORDER BY qty DESC, revenue DESC
  `).all();
  json(res, 200, { ok: true, data: rows });
});

app.get('/api/reports/ramen-peak', (req, res) => {
  const days = Math.max(1, Math.min(30, parseIntSafe(req.query.days, 7)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT strftime('%H', o.created_at) AS hour,
           SUM(oi.qty) AS qty,
           COALESCE(SUM(oi.subtotal), 0) AS revenue
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.created_at >= ? AND oi.category = 'ramen'
    GROUP BY hour
    ORDER BY hour ASC
  `).all(since);

  const map = new Map(rows.map(r => [r.hour, r]));
  const data = Array.from({ length: 24 }, (_, i) => {
    const h = String(i).padStart(2, '0');
    return map.get(h) || { hour: h, qty: 0, revenue: 0 };
  });
  json(res, 200, { ok: true, data });
});

app.get('/api/reports/product-peak', (req, res) => {
  const days = Math.max(1, Math.min(30, parseIntSafe(req.query.days, 7)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT strftime('%H', o.created_at) AS hour,
           oi.item_key,
           oi.item_name,
           SUM(oi.qty) AS qty,
           SUM(oi.subtotal) AS revenue
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.created_at >= ?
    GROUP BY hour, oi.item_key, oi.item_name
    ORDER BY qty DESC, revenue DESC
  `).all(since);
  json(res, 200, { ok: true, data: rows });
});

app.get('/api/production/state', (req, res) => {
  json(res, 200, { ok: true, state: listInventoryState() });
});

app.patch('/api/production/:component', (req, res) => {
  const component = String(req.params.component || '');
  if (!['ramen', 'haws'].includes(component)) {
    return json(res, 400, { ok: false, message: 'component ???' });
  }

  const expectedRole = kitchenRoleFor(component);
  if (![expectedRole, 'admin'].includes(req.session.role)) {
    return json(res, 403, { ok: false, message: '????????????' });
  }

  const body = getBody(req);
  const now = taipeiNow();

  if (component === 'ramen') {
    const current = getInventoryRow('ramen', 'ramen');
      const nextSoldOut = body.sold_out == null ? current.sold_out : (body.sold_out ? 1 : 0);
      db.prepare(`
        UPDATE production_inventory
        SET prepared_count = ?, sold_out = ?, updated_at = ?
        WHERE component = 'ramen' AND item_key = 'ramen'
      `).run(0, nextSoldOut, now);
  } else {
    const updates = Array.isArray(body.types) ? body.types : [];
    const updateStmt = db.prepare(`
      UPDATE production_inventory
      SET prepared_count = ?, sold_out = ?, updated_at = ?
      WHERE component = 'haws' AND item_key = ?
    `);

    for (const item of updates) {
      const itemKey = String(item.item_key || '');
      if (!['mix', 'grape', 'tomato'].includes(itemKey)) continue;
      const current = getInventoryRow('haws', itemKey);
      const nextPrepared = item.prepared_count == null ? current.prepared_count : Math.max(0, parseIntSafe(item.prepared_count, 0));
      const nextSoldOut = item.sold_out == null ? current.sold_out : (item.sold_out ? 1 : 0);
      updateStmt.run(nextPrepared, nextSoldOut, now, itemKey);
    }
  }

  json(res, 200, { ok: true, state: listInventoryState() });
});

app.post('/api/orders/:id/return', requireSession('counter', 'admin'), (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id);
  if (!order) return json(res, 404, { ok: false, message: '?????' });

  const { component, reason } = getBody(req);
  if (!['ramen', 'haws'].includes(component)) {
    return json(res, 400, { ok: false, message: 'component ???' });
  }

  const requiredField = component === 'ramen' ? 'ramen_required' : 'haws_required';
  const doneField = component === 'ramen' ? 'ramen_done' : 'haws_done';
  if (!order[requiredField]) {
    return json(res, 400, { ok: false, message: '????????????' });
  }

  const targetLabel = component === 'ramen' ? '?????' : '??????';
  const returnNote = reason ? String(reason).trim() : `???? ${targetLabel}`;
  db.prepare(`
    UPDATE orders
    SET ${doneField} = 0,
        status = 'waiting',
        pickup_state = 'normal',
        return_note = ?,
        updated_at = ?
    WHERE id = ?
  `).run(returnNote, taipeiNow(), order.id);

  logStatus(order.id, order.status, 'waiting', returnNote);
  json(res, 200, { ok: true, order: toOrderResponse(order.id) });
});

app.get('/api/kitchen/queue', (req, res) => {
  const role = req.query.role;
  const orders = db.prepare(`
    SELECT * FROM orders
    WHERE status IN ('waiting', 'preparing')
    ORDER BY created_at ASC
  `).all().map(serializeOrder);

  const filtered = orders.map(order => {
    const items = order.items.filter(item =>
      role === 'kitchen_ramen' ? item.category === 'ramen' :
      role === 'kitchen_haws' ? item.category === 'haws' :
      true
    );
    return { ...order, items };
  }).filter(order => order.items.length > 0);

  json(res, 200, { ok: true, orders: filtered });
});

app.get('/api/counter/queue', (req, res) => {
  const orders = db.prepare(`
    SELECT * FROM orders
    WHERE status = 'ready'
    ORDER BY CASE pickup_state WHEN 'unclaimed' THEN 1 ELSE 0 END ASC, created_at ASC
  `).all().map(serializeOrder);
  json(res, 200, { ok: true, orders });
});

app.get('/api/app/bootstrap', (req, res) => {
  const user = req.session ? { role: req.session.role, username: req.session.username, label: roleLabel(req.session.role) } : null;
  json(res, 200, {
    ok: true,
    user,
    systemKey: config.systemKey,
    users: Object.keys(config.users).map(role => ({ role, label: config.users[role].label })),
    permissions: {
      cashier: ['cashier'],
      kitchen_ramen: ['kitchen_ramen', 'admin'],
      kitchen_haws: ['kitchen_haws', 'admin'],
      counter: ['counter', 'admin'],
      finance: ['finance', 'admin'],
      admin: ['admin']
    }
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  json(res, 500, { ok: false, message: '伺服器錯誤' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`${config.appName} running on http://127.0.0.1:${PORT}`);
});
