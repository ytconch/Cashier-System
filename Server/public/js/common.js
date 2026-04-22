const API = {
  async request(path, options = {}) {
    const token = localStorage.getItem('sessionToken');
    const headers = {
      ...(window.APP_CONFIG ? window.APP_CONFIG.apiHeaders() : { 'Content-Type': 'application/json' }),
      ...(token ? { 'X-Session-Token': token } : {}),
      ...(options.headers || {})
    };
    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.message || `Request failed: ${res.status}`);
    }
    return data;
  }
};

const STATUS_TEXT = {
  waiting: '待處理',
  preparing: '製作中',
  ready: '可取餐',
  picked_up: '已取餐',
  canceled: '已取消',
  expired: '已逾時'
};

const ROLE_TEXT = {
  cashier: '收銀組',
  kitchen_ramen: '涼麵製作組',
  kitchen_haws: '糖葫蘆製作組',
  counter: '櫃台組',
  finance: '財務組',
  admin: '管理員'
};

const PRODUCTION_TEXT = {
  ramen: '涼麵',
  haws: '糖葫蘆'
};

function statusLabel(status) {
  return STATUS_TEXT[status] || status;
}

function productionLabel(component) {
  return PRODUCTION_TEXT[component] || component;
}

function money(value) {
  return `NT$ ${Number(value || 0).toLocaleString('zh-TW')}`;
}

function esc(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function ramenOptionText(options = {}) {
  const chicken = { none: '不加雞絲', add: '加雞絲', double: '雙倍雞絲' }[options.chicken] || '不加雞絲';
  const sauce = { soy: '醬油', sesame: '麻醬' }[options.sauce] || '醬油';
  const spicy = options.spicy ? '辣' : '不辣';
  const eco = options.eco ? '環保餐具' : '一般餐具';
  const cucumber = options.cucumber ? '小黃瓜' : '不要小黃瓜';
  const carrot = options.carrot ? '紅蘿蔔' : '不要紅蘿蔔';
  return [chicken, sauce, spicy, cucumber, carrot, eco].join(' / ');
}

function hawsOptionText(options = {}) {
  return `口味：${{ mix: '綜合', grape: '葡萄', tomato: '小番茄' }[options.type] || '綜合'}`;
}

function renderOrderItems(items) {
  return (items || []).map((item) => {
    let optionText = '無附加選項';
    if (item.category === 'ramen') optionText = ramenOptionText(item.options || {});
    if (item.category === 'haws') optionText = hawsOptionText(item.options || {});

    return `
      <div class="item-line">
        <div>
          <div class="item-title">${esc(item.display_text || item.item_name)} x ${esc(item.qty)}</div>
          <div class="muted small">${esc(optionText)}</div>
        </div>
        <div class="small muted">${money(item.subtotal)}</div>
      </div>
    `;
  }).join('');
}

function orderCard(order, extraActions = '', compact = false) {
  return `
    <div class="order-card ${compact ? 'compact' : ''}" data-order-id="${order.id}">
      <div class="order-head">
        <div>
          <div class="order-no">#${esc(order.order_no)}</div>
          <div class="order-meta">
            <span class="badge ${esc(order.status)}">${esc(statusLabel(order.status))}</span>
            ${order.pickup_state === 'unclaimed' ? '<span class="pill">未領餐</span>' : ''}
          </div>
        </div>
        <div style="text-align:right">
          <div class="muted small">總額</div>
          <div class="price">${money(order.total_amount)}</div>
        </div>
      </div>
      ${order.return_note ? `<div class="return-note">${esc(order.return_note)}</div>` : ''}
      <div class="items">${renderOrderItems(order.items || [])}</div>
      ${extraActions}
    </div>
  `;
}

function logout() {
  localStorage.removeItem('sessionToken');
  localStorage.removeItem('sessionRole');
  localStorage.removeItem('sessionLabel');
  location.href = 'index.html';
}

function setSession(token, role, label) {
  localStorage.setItem('sessionToken', token);
  localStorage.setItem('sessionRole', role);
  localStorage.setItem('sessionLabel', label);
}

function currentRole() {
  return localStorage.getItem('sessionRole') || '';
}

function currentLabel() {
  return localStorage.getItem('sessionLabel') || '';
}

async function bootstrapApp() {
  try {
    const data = await API.request('/api/app/bootstrap');
    window.APP_BOOT = data;
    return data;
  } catch {
    return null;
  }
}
