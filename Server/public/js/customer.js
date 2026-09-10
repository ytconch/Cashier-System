const inputEl = document.getElementById('orderNo');
const resultEl = document.getElementById('result');
let timer = null;
let lastStatus = '';

// 輔助函式：處理時間格式 (YYYY-MM-DD HH:mm)
function formatTime(rawTime) {
  if (!rawTime) return '--:--';
  return rawTime.replace('T', ' ').split('.')[0].slice(0, 16);
}

// 輔助函式：計算訂單品項總金額 (相容 subtotal 與 unit_price/qty)
function calculateTotal(items = []) {
  return items.reduce((sum, item) => {
    const sub = item.subtotal != null ? Number(item.subtotal) : (Number(item.unit_price || item.price || 0) * Number(item.qty || item.quantity || 1));
    return sum + sub;
  }, 0);
}

async function queryOrder() {
  const orderNo = inputEl.value.trim();
  if (!orderNo) {
    resultEl.innerHTML = '<div class="empty-state">輸入訂單編號後即可查詢</div>';
    return;
  }

  try {
    // 顯示微小的載入狀態（選配）
    const data = await API.request(`/api/customer/${encodeURIComponent(orderNo)}`);
    const order = data.order;
    const items = order.items || [];

    // 狀態變更震動提醒
    if (lastStatus && lastStatus !== order.status && order.status === 'ready' && navigator.vibrate) {
      navigator.vibrate([250, 120, 250]);
    }
    lastStatus = order.status;

    resultEl.innerHTML = `
      <div class="order-card">
        <div class="order-head">
          <div class="order-info">
            <div class="order-no">#${esc(order.order_no)}</div>
            <div class="order-meta">
              <span class="badge ${esc(order.status)}">${esc(order.status_label)}</span>
              ${order.pickup_state === 'unclaimed' ? '<span class="pill">未領取</span>' : ''}
            </div>
          </div>
          <div class="order-time">
            <div class="muted small">建立時間</div>
            <div class="time-text">${esc(formatTime(order.created_at || order.time))}</div>
          </div>
        </div>

        <div class="items-section">
          <div class="section-title">明細</div>
          <div class="items-list">${CustomerrenderOrderItems(items)}</div>
        </div>

        <div class="order-footer">
          <div class="total-row">
            <span>總金額</span>
            <span class="total-amount">${money(order.total_amount != null ? order.total_amount : calculateTotal(items))}</span>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    resultEl.innerHTML = `<div class="empty-state error">查詢失敗：${esc(err.message)}</div>`;
  }
}

function startQuery() {
  if (!inputEl.value.trim()) return;
  queryOrder();
  if (timer) clearInterval(timer);
  timer = setInterval(queryOrder, 3000);
}

// 監聽 Enter 鍵
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startQuery();
});

// 全域方法
window.startQuery = startQuery;
window.clearQuery = function () {
  inputEl.value = '';
  resultEl.innerHTML = '<div class="empty-state">輸入訂單編號後即可查詢</div>';
  if (timer) clearInterval(timer);
  timer = null;
  lastStatus = '';
};

// 初始化
window.clearQuery();

/**
 * 渲染顧客端訂單明細列表
 * @param {Array} items 訂單品項陣列
 */
function CustomerrenderOrderItems(items) {
  if (!items || items.length === 0) {
    return '<div class="muted">無明細資料</div>';
  }

  return items.map(item => {
    // 依序取得顯示名稱：客製化選項文字 -> 品項名稱
    const displayName = item.display_text || item.item_name || item.name || item.title || '未知商品';
    const qty = item.qty != null ? item.qty : (item.quantity != null ? item.quantity : 1);
    
    // 計算或取得小計金額
    const subtotal = item.subtotal != null ? item.subtotal : (Number(item.unit_price || item.price || 0) * Number(qty));

    return `
      <div class="item-row">
        <div class="item-info">
          <div class="item-name">${esc(displayName)}</div>
          <div class="item-qty muted">x ${esc(qty)}</div>
        </div>
        <div class="item-price">${money(subtotal)}</div>
      </div>
    `;
  }).join('');
}