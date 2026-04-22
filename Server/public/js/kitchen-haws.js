const queueEl = document.getElementById('queue');
const titleEl = document.getElementById('roleTitle');
const rowsEl = document.getElementById('hawsInventoryRows');

const HAWS_TYPES = [
  { key: 'mix', label: '綜合' },
  { key: 'grape', label: '葡萄' },
  { key: 'tomato', label: '小番茄' }
];

const draftCounts = {};
const dirtyKeys = new Set();

titleEl.textContent = '糖葫蘆製作組';

function ensureDraftCount(itemKey, fallback = 0) {
  if (typeof draftCounts[itemKey] !== 'number') {
    draftCounts[itemKey] = fallback;
  }
}

function renderCountValue(itemKey) {
  const valueEl = rowsEl.querySelector(`[data-count-key="${itemKey}"]`);
  if (valueEl) {
    valueEl.textContent = String(Math.max(0, draftCounts[itemKey] || 0));
  }
}

function renderDirtyState(itemKey) {
  const flagEl = rowsEl.querySelector(`[data-dirty-key="${itemKey}"]`);
  if (!flagEl) return;
  flagEl.textContent = dirtyKeys.has(itemKey) ? '尚未更新到系統' : '已與系統同步';
}

function changePreparedCount(itemKey, delta) {
  ensureDraftCount(itemKey, 0);
  draftCounts[itemKey] = Math.max(0, draftCounts[itemKey] + delta);
  dirtyKeys.add(itemKey);
  renderCountValue(itemKey);
  renderDirtyState(itemKey);
}

function renderInventoryRows(state) {
  rowsEl.innerHTML = HAWS_TYPES.map((type) => {
    const item = state?.haws?.types?.[type.key] || {};
    const serverCount = Number(item.prepared_count || 0);
    ensureDraftCount(type.key, serverCount);

    if (!dirtyKeys.has(type.key)) {
      draftCounts[type.key] = serverCount;
    }

    return `
      <div class="option-box">
        <h3>${type.label}</h3>
        <div class="field">
          <span>預製份數</span>
          <div class="stepper-row">
            <button type="button" class="qty-btn stepper-btn" onclick="changePreparedCount('${type.key}', -1)">-</button>
            <div class="stepper-value" data-count-key="${type.key}">${Math.max(0, draftCounts[type.key] || 0)}</div>
            <button type="button" class="qty-btn stepper-btn" onclick="changePreparedCount('${type.key}', 1)">+</button>
          </div>
        </div>
        <div class="muted small">狀態：${item.sold_out ? '已售罄' : '可接單'}</div>
        <div class="muted small" data-dirty-key="${type.key}">${dirtyKeys.has(type.key) ? '尚未更新到系統' : '已與系統同步'}</div>
        <div class="actions">
          <button class="good" onclick="saveSingleType('${type.key}')">更新此口味</button>
          <button class="${item.sold_out ? 'good' : 'warn'}" onclick="toggleSoldOut('${type.key}')">${item.sold_out ? '取消售罄' : '回報售罄'}</button>
        </div>
      </div>
    `;
  }).join('');
}

async function loadProductionState() {
  const data = await API.request('/api/production/state');
  renderInventoryRows(data.state || {});
}

async function saveSingleType(itemKey) {
  await API.request('/api/production/haws', {
    method: 'PATCH',
    body: JSON.stringify({
      types: [{
        item_key: itemKey,
        prepared_count: Math.max(0, Number(draftCounts[itemKey] || 0))
      }]
    })
  });
  dirtyKeys.delete(itemKey);
  await loadProductionState();
}

async function toggleSoldOut(itemKey) {
  const data = await API.request('/api/production/state');
  const current = data.state?.haws?.types?.[itemKey];
  await API.request('/api/production/haws', {
    method: 'PATCH',
    body: JSON.stringify({
      types: [{
        item_key: itemKey,
        sold_out: !current?.sold_out
      }]
    })
  });
  await loadProductionState();
}

async function loadQueue() {
  try {
    const data = await API.request('/api/kitchen/queue?role=kitchen_haws');
    const orders = (data.orders || []).filter((order) => Number(order.haws_done) === 0);

    if (!orders.length) {
      queueEl.innerHTML = '<div class="empty-state">目前沒有待處理的糖葫蘆訂單</div>';
      return;
    }

    queueEl.innerHTML = orders.map((order) => {
      const extra = `
        <div class="actions">
          <button class="secondary" onclick="markPreparing(${order.id})">開始製作</button>
          <button class="good" onclick="finishComponent(${order.id})">完成糖葫蘆</button>
        </div>
      `;
      return orderCard(order, extra, true);
    }).join('');
  } catch (err) {
    queueEl.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

async function markPreparing(id) {
  await API.request(`/api/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'preparing' })
  });
  loadQueue();
}

async function finishComponent(id) {
  await API.request(`/api/orders/${id}/component`, {
    method: 'PATCH',
    body: JSON.stringify({ component: 'haws', done: true })
  });
  await Promise.all([loadQueue(), loadProductionState()]);
}

loadProductionState();
loadQueue();
setInterval(loadQueue, 1000);
setInterval(loadProductionState, 3000);
