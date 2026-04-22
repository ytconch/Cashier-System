const inputEl = document.getElementById('orderNo');
const resultEl = document.getElementById('result');
let timer = null;
let lastStatus = '';

// 輔助函式：處理時間格式 (YYYY-MM-DD HH:mm)
function formatTime(rawTime) {
  if (!rawTime) return '--:--';
  return rawTime.replace('T', ' ').split('.')[0].slice(0, 16);
}

// 輔助函式：計算總金額 (假設 order.items 內有 price 與 quantity)
function calculateTotal(items) {
  return items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 1)), 0);
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
            <span class="total-amount">$${esc(items.reduce((sum,cur)=>{
              sum += cur.subtotal
              return sum
            } , 0))}</span>
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
 * 渲染訂單項目列表
 * 修正：增加欄位自動偵測，確保名稱能顯示
 */
function CustomerrenderOrderItems(items) {
  if (!items || items.length === 0) {
    return '<div class="muted">無明細資料</div>';
  }

  return items.map(item => {
    // 優先順序：name -> title -> item_name -> product_name
    // 如果都沒有，就顯示 "未知商品"
    const displayName = item.name || item.title || item.item_name || item.product_name || '未知商品';
    
    // 確保金額計算正確，優先取 subtotal
    const displayPrice = item.subtotal || (Number(item.price || 0) * Number(item.quantity || 1));

    return `
      <div class="item-row">
        <div class="item-info">
          <div class="item-name">${esc(displayName)}</div>
          <div class="item-qty muted">x ${esc(item.quantity || 1)}</div>
        </div>
        <div class="item-price">$${esc(displayPrice)}</div>
      </div>
    `;
  }).join('');
}