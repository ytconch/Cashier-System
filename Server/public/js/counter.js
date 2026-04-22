const queueEl = document.getElementById('queue');
const titleEl = document.getElementById('roleTitle');

titleEl.textContent = '櫃台組';

async function loadQueue() {
  try {
    const data = await API.request('/api/counter/queue');
    if (!data.orders.length) {
      queueEl.innerHTML = '<div class="empty-state">目前沒有可取餐訂單</div>';
      return;
    }

    queueEl.innerHTML = data.orders.map((order) => {
      const returnButtons = [];
      if (Number(order.ramen_required) > 0) {
        returnButtons.push(`<button class="secondary" onclick="sendBack(${order.id}, 'ramen')">退回涼麵組</button>`);
      }
      if (Number(order.haws_required) > 0) {
        returnButtons.push(`<button class="secondary" onclick="sendBack(${order.id}, 'haws')">退回糖葫蘆組</button>`);
      }

      const extra = `
        <div class="actions">
          <button class="good" onclick="pickup(${order.id})">完成取餐</button>
          <button class="warn" onclick="markUnclaimed(${order.id})">標記未領</button>
          ${returnButtons.join('')}
        </div>
      `;
      return orderCard(order, extra, true);
    }).join('');
  } catch (err) {
    queueEl.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

async function pickup(id) {
  await API.request(`/api/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'picked_up', pickup_state: 'normal' })
  });
  loadQueue();
}

async function markUnclaimed(id) {
  await API.request(`/api/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ready', pickup_state: 'unclaimed' })
  });
  loadQueue();
}

async function sendBack(id, component) {
  const target = component === 'ramen' ? '涼麵製作組' : '糖葫蘆製作組';
  await API.request(`/api/orders/${id}/return`, {
    method: 'POST',
    body: JSON.stringify({
      component,
      reason: `櫃台退回 ${target}`
    })
  });
  loadQueue();
}

loadQueue();
setInterval(loadQueue, 1000);
