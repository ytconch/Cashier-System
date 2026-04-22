const component = 'ramen';
const queueEl = document.getElementById('queue');
const titleEl = document.getElementById('roleTitle');
const statusMetaEl = document.getElementById('preparedMeta');
const soldOutBtn = document.getElementById('soldOutBtn');

titleEl.textContent = '涼麵製作組';

async function loadProductionState() {
  const data = await API.request('/api/production/state');
  const state = data.state?.ramen || {};
  statusMetaEl.textContent = state.sold_out
    ? '目前狀態：已售罄'
    : '目前狀態：可接單';
  soldOutBtn.textContent = state.sold_out ? '取消售罄' : '回報售罄';
  soldOutBtn.className = state.sold_out ? 'good' : 'warn';
}

async function toggleSoldOut() {
  const data = await API.request('/api/production/state');
  const current = data.state?.ramen;
  await API.request(`/api/production/${component}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sold_out: !current?.sold_out
    })
  });
  await loadProductionState();
}

async function loadQueue() {
  try {
    const data = await API.request('/api/kitchen/queue?role=kitchen_ramen');
    const orders = (data.orders || []).filter((order) => Number(order.ramen_done) === 0);

    if (!orders.length) {
      queueEl.innerHTML = '<div class="empty-state">目前沒有待處理的涼麵訂單</div>';
      return;
    }

    queueEl.innerHTML = orders.map((order) => {
      const extra = `
        <div class="actions">
          <button class="secondary" onclick="markPreparing(${order.id})">開始製作</button>
          <button class="good" onclick="finishComponent(${order.id})">完成涼麵</button>
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
    body: JSON.stringify({ component: 'ramen', done: true })
  });
  await Promise.all([loadQueue(), loadProductionState()]);
}

loadProductionState();
loadQueue();
setInterval(loadQueue, 1000);
setInterval(loadProductionState, 3000);
