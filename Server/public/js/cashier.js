const cart = [];
const cartEl = document.getElementById('cart');
const totalEl = document.getElementById('cartTotal');
const previewEl = document.getElementById('preview');
const msgEl = document.getElementById('message');
const ramenCard = document.getElementById('ramenCard');
const hawsCard = document.getElementById('hawsCard');
let CONFIG = null;
let PRODUCTION_STATE = {};

const HAWS_LABELS = {
  mix: '綜合',
  grape: '葡萄',
  tomato: '小番茄'
};

async function loadConfig() {
  CONFIG = await API.request('/api/config');
}

async function loadProductionState() {
  const data = await API.request('/api/production/state');
  PRODUCTION_STATE = data.state || {};
  applySoldOutState();
}

function clampQty(v, min = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(99, Math.trunc(n)));
}

function changeQty(id, delta) {
  const el = document.getElementById(id);
  if (!el) return;
  const min = el.min === '' ? 0 : Number(el.min || 0);
  el.value = clampQty((Number(el.value || 0) || 0) + delta, min);
}

function readCardValue(card, targetId) {
  const el = card.querySelector(`#${CSS.escape(targetId)}`);
  if (!el) throw new Error(`找不到欄位 ${targetId}`);
  return el.value;
}

function getRamenData(card) {
  return {
    category: 'ramen',
    itemKey: 'ramen',
    qty: clampQty(readCardValue(card, 'ramenQty'), 1),
    options: {
      chicken: readCardValue(card, 'ramenChicken'),
      sauce: readCardValue(card, 'ramenSauce'),
      spicy: readCardValue(card, 'ramenSpicy') === 'true',
      eco: readCardValue(card, 'ramenEco') === 'true',
      cucumber: readCardValue(card, 'ramenCucumber') === 'true',
      carrot: readCardValue(card, 'ramenCarrot') === 'true'
    }
  };
}

function getHawsData(card) {
  return {
    category: 'haws',
    itemKey: readCardValue(card, 'hawsType'),
    qty: clampQty(readCardValue(card, 'hawsQty'), 1),
    options: {
      type: readCardValue(card, 'hawsType')
    }
  };
}

function calcPrice(item) {
  if (item.category === 'ramen') {
    const ramen = CONFIG.prices.ramen;
    const unit =
      ramen.basePrice +
      (ramen.chicken[item.options.chicken]?.price ?? 0) +
      (ramen.sauce[item.options.sauce]?.price ?? 0) +
      (ramen.spicy[item.options.spicy ? 'yes' : 'no']?.price ?? 0) +
      (ramen.eco[item.options.eco ? 'yes' : 'no']?.price ?? 0);
    return unit * item.qty;
  }

  if (item.category === 'haws') {
    return (CONFIG.prices.haws.types[item.itemKey]?.price || 35) * item.qty;
  }

  if (item.category === 'drink') {
    return (CONFIG.prices.drinks.items[item.itemKey]?.price || 20) * item.qty;
  }

  return 0;
}

function displayRamen(item) {
  return ramenOptionText(item.options || {});
}

function displayHaws(item) {
  return HAWS_LABELS[item.itemKey] || item.itemKey;
}

function ramenSoldOut() {
  return Boolean(PRODUCTION_STATE?.ramen?.sold_out);
}

function selectedHawsType() {
  return document.getElementById('hawsType')?.value || 'mix';
}

function hawsSoldOut(itemKey) {
  return Boolean(PRODUCTION_STATE?.haws?.types?.[itemKey]?.sold_out);
}

function applySoldOutState() {
  const ramenBtn = ramenCard?.querySelector('button[onclick^="addRamen"]');
  const hawsBtn = hawsCard?.querySelector('button[onclick^="addHaws"]');
  const hawsType = selectedHawsType();

  if (ramenBtn) {
    ramenBtn.disabled = ramenSoldOut();
    ramenBtn.textContent = ramenSoldOut() ? '涼麵已售罄' : '加入涼麵';
  }

  if (hawsBtn) {
    hawsBtn.disabled = hawsSoldOut(hawsType);
    hawsBtn.textContent = hawsSoldOut(hawsType) ? `${HAWS_LABELS[hawsType]}已售罄` : '加入糖葫蘆';
  }
}

function renderCart() {
  const total = cart.reduce((sum, item) => sum + calcPrice(item), 0);
  totalEl.textContent = money(total);

  if (!cart.length) {
    cartEl.innerHTML = '<div class="empty-state">目前還沒有商品</div>';
    previewEl.innerHTML = '<div class="empty-state">送出訂單後會顯示預覽</div>';
    return;
  }

  cartEl.innerHTML = cart.map((item, idx) => {
    const title = item.category === 'drink'
      ? `飲料 / ${item.name}`
      : item.category === 'ramen'
        ? `涼麵 / ${displayRamen(item)}`
        : `糖葫蘆 / ${displayHaws(item)}`;
    return `
      <div class="cart-item">
        <div>
          <div class="item-title">${esc(title)}</div>
          <div class="muted small">數量 ${item.qty} / ${money(calcPrice(item))}</div>
        </div>
        <button class="bad" onclick="removeItem(${idx})">刪除</button>
      </div>
    `;
  }).join('');

  previewEl.innerHTML = cart.slice().reverse().map((item) => {
    const name = item.category === 'drink' ? item.name : item.category === 'ramen' ? '涼麵' : '糖葫蘆';
    const detail = item.category === 'ramen' ? displayRamen(item) : item.category === 'haws' ? displayHaws(item) : item.name;
    return `
      <div class="item-line">
        <div>
          <div class="item-title">${esc(name)} x ${esc(item.qty)}</div>
          <div class="muted small">${esc(detail)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function removeItem(index) {
  cart.splice(index, 1);
  renderCart();
}

function addRamen(btn) {
  if (ramenSoldOut()) {
    msgEl.textContent = '涼麵目前已售罄，不能加入訂單。';
    return;
  }

  try {
    cart.push(getRamenData(btn.closest('#ramenCard') || ramenCard));
    msgEl.textContent = '已加入涼麵';
    renderCart();
  } catch (err) {
    msgEl.textContent = err.message;
  }
}

function addHaws(btn) {
  const itemKey = selectedHawsType();
  if (hawsSoldOut(itemKey)) {
    msgEl.textContent = `${HAWS_LABELS[itemKey]}目前已售罄，不能加入訂單。`;
    return;
  }

  try {
    cart.push(getHawsData(btn.closest('#hawsCard') || hawsCard));
    msgEl.textContent = '已加入糖葫蘆';
    renderCart();
  } catch (err) {
    msgEl.textContent = err.message;
  }
}

function addDrinks() {
  const items = [
    ['black', '紅茶'],
    ['green', '綠茶'],
    ['roselle', '洛神花茶'],
    ['winter', '冬瓜茶']
  ];
  let added = 0;

  for (const [key, name] of items) {
    const qtyEl = document.getElementById(`drink_${key}`);
    const qty = Math.max(0, Number(qtyEl?.value || 0));
    if (qty > 0) {
      cart.push({ category: 'drink', itemKey: key, name, qty, options: {} });
      added += qty;
      qtyEl.value = 0;
    }
  }

  msgEl.textContent = added ? `已加入 ${added} 杯飲料` : '尚未選擇飲料數量';
  renderCart();
}

async function submitOrder() {
  if (!cart.length) {
    msgEl.textContent = '請先加入商品';
    return;
  }

  try {
    const payload = {
      items: cart.map((item) => ({
        category: item.category,
        itemKey: item.category === 'ramen' ? 'ramen' : item.itemKey,
        qty: item.qty,
        options: item.options || {}
      }))
    };

    const data = await API.request('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    msgEl.textContent = `訂單已建立 #${data.order.order_no}`;
    cart.length = 0;
    renderCart();
    renderPreview(data.order);
    await loadProductionState();
  } catch (err) {
    msgEl.textContent = err.message;
  }
}

function renderPreview(order) {
  previewEl.innerHTML = `
    <div class="order-card">
      <div class="order-head">
        <div>
          <div class="order-no">#${esc(order.order_no)}</div>
          <div class="order-meta">
            <span class="badge ${esc(order.status)}">${esc(order.status_label)}</span>
            <span class="pill">${esc(order.created_at)}</span>
          </div>
        </div>
        <div class="price">${money(order.total_amount)}</div>
      </div>
      <div class="items">${renderOrderItems(order.items)}</div>
    </div>
  `;
}

function clearCart() {
  cart.length = 0;
  msgEl.textContent = '購物車已清空';
  renderCart();
}

(async () => {
  await loadConfig();
  await loadProductionState();
  renderCart();
  setInterval(loadProductionState, 3000);
})();
