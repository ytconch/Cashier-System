const summaryEl = document.getElementById('live-kpi');
const hourlyEl = document.getElementById('hourly');
const workloadEl = document.getElementById('workload');
const productStatsEl = document.getElementById('product-stats');

// 核心繪圖工具：顯示橫向進度條
function renderProgressBar(value, max, label = '', color = 'var(--primary)') {
  const percent = Math.min(100, (value / max) * 100);
  return `
    <div class="bar-row">
      <div class="bar-label">${esc(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${percent}%; background:${color}"></div></div>
      <div class="bar-value">${value}</div>
    </div>
  `;
}

async function deleteOrder(id, orderNo) {
  if (!confirm(`確定要永久刪除訂單 #${orderNo} 嗎？此動作無法復原。`)) return

  try {
    const res = await API.request(`/api/orders/${id}`, {
      method: 'DELETE'
    })

    if (res.ok) {
      alert('訂單已刪除')
      loadFinance() // 立即重新整理數據
    } else {
      alert('刪除失敗：' + res.message)
    }
  } catch (err) {
    console.error('刪除請求出錯', err)
    alert('系統錯誤，無法刪除')
  }
}

async function loadFinance() {
  try {
    // 平行向伺服器拉取摘要指標、小時營收、品項獲利與即時訂單
    const [summary, hourly, menu, ordersData] = await Promise.all([
      API.request('/api/dashboard/summary'),
      API.request('/api/reports/hourly?days=1'),
      API.request('/api/reports/menu'),
      API.request('/api/orders')
    ]);

    const s = summary.summary;
    const hData = hourly.data || [];
    const allOrdersEl = document.getElementById('all-orders-list');

    // 1. KPI 戰情看板
    const avgOrder = s.today_orders ? (s.today_revenue / s.today_orders).toFixed(0) : 0;
    summaryEl.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi primary">
          <div class="kpi-title">今日實收金額</div>
          <div class="kpi-value">${money(s.today_revenue)}</div>
        </div>
        <div class="kpi success">
          <div class="kpi-title">預估毛利 (淨收)</div>
          <div class="kpi-value">${money(s.today_profit)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-title">平均每單消費</div>
          <div class="kpi-value">$${avgOrder}</div>
        </div>
        <div class="kpi warning">
          <div class="kpi-title">目前待餐總數</div>
          <div class="kpi-value">${(s.waiting_count || 0) + (s.preparing_count || 0)} 單</div>
        </div>
      </div>
    `;

    // 2. 今日小時營收趨勢
    if (hData.length > 0) {
      const width = 400;  // 畫布寬度
      const height = 150; // 畫布高度
      const padding = 20;

      const maxRev = Math.max(...hData.map(d => d.revenue), 1);

      // 計算點的座標
      const points = hData.map((d, i) => {
        const x = (i / (hData.length - 1)) * (width - padding * 2) + padding;
        const y = height - ((d.revenue / maxRev) * (height - padding * 2) + padding);
        return `${x},${y}`;
      }).join(' ');

      hourlyEl.innerHTML = `
        <div style="background: #f8f9fa; padding: 10px; border-radius: 8px;">
          <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; display: block;">
            <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#dee2e6" stroke-width="1" />
            
            <polyline fill="none" stroke="#228be6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${points}" />
            
            ${hData.map((d, i) => {
        const [px, py] = points.split(' ')[i].split(',');
        return `<circle cx="${px}" cy="${py}" r="4" fill="#228be6" />`;
      }).join('')}
          </svg>
          <div style="display: flex; justify-content: space-between; margin-top: 5px; color: #868e96; font-size: 10px;">
            <span>${hData[0].hour}時</span>
            <span>時段營收趨勢</span>
            <span>${hData[hData.length - 1].hour}時</span>
          </div>
        </div>
      `;
    } else {
      hourlyEl.innerHTML = '<div class="empty-state">尚無數據</div>';
    }
    // 3. 後勤負荷 (根據你的後端字段，呈現塞車狀況)
    workloadEl.innerHTML = `
      ${renderProgressBar(s.waiting_count || 0, 20, '未處理單', '#ff6b6b')}
      ${renderProgressBar(s.preparing_count || 0, 20, '製作中單', '#fcc419')}
      <div class="muted small text-center">※ 若未處理單超過 10，請考慮暫緩收銀</div>
    `;

    // 4. 品項獲利排行 (獲利貢獻度)
    const totalProfit = s.today_profit || 1;
    // 按毛利 (profit) 排序，最賺錢的在上面
    const sortedMenu = menu.data.sort((a, b) => b.profit - a.profit);

    productStatsEl.innerHTML = sortedMenu.map(r => {
      const contribution = ((r.profit / totalProfit) * 100).toFixed(1);
      return `
        <tr>
          <td><strong>${esc(r.item_name)}</strong></td>
          <td>${esc(r.qty)} 份</td>
          <td>${money(r.revenue)}</td>
          <td class="text-success">${money(r.profit)}</td>
          <td>
            <div class="mini-bar">
              <div class="mini-fill" style="width: ${contribution}%"></div>
              <span class="small">${contribution}%</span>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (allOrdersEl && ordersData.orders) {
      allOrdersEl.innerHTML = ordersData.orders.map(order => {
        // 1. 狀態顏色
        let statusColor = '#666';
        if (order.status === 'waiting') statusColor = '#fa5252';
        if (order.status === 'ready') statusColor = '#40c057';

        // 2. 格式化時間 (將 ISO 字串中的 T 轉為空格並去除毫秒)
        const rawTime = order.created_at || order.time || '';
        const timeStr = rawTime ? rawTime.replace('T', ' ').split('.')[0] : '--:--';

        // 3. 訂單總金額 (優先取後端計算好的 total_amount，若無則依品項加總)
        const totalAmount = order.total_amount != null
          ? order.total_amount
          : (order.items || []).reduce((sum, item) => sum + (item.subtotal || (item.unit_price || 0) * (item.qty || 1)), 0);

        // 4. 品項摘要
        const summary = order.items && order.items.length > 0
          ? order.items.map(i => `${i.item_name || i.name}x${i.qty}`).join(', ')
          : '無品項資料';

        return `
  <tr style="font-size: 0.9rem; border-bottom: 1px solid #eee;">
    <td style="padding: 10px;"><strong>#${esc(order.order_no)}</strong></td>
    <td style="padding: 10px; color: #666;">${esc(timeStr)}</td>
    <td style="padding: 10px;">${esc(summary)}</td>
    <td style="padding: 10px; font-weight: bold;">${money(totalAmount)}</td>
    <td style="padding: 10px;">
      <span style="color: ${statusColor}; font-weight: bold;">${esc(order.status_label)}</span>
    </td>
    <td style="padding: 10px;">
      <button onclick="deleteOrder(${order.id}, '${order.order_no}')" 
              style="background:#ff6b6b; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">
        刪除
      </button>
    </td>
  </tr>
`;
      }).join('');
    }

    // 更新最後同步時間
    document.getElementById('last-update').textContent = `最後更新：${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error("財務報表更新失敗", err);
  }
}

// 每 2 秒自動重新整理財務數據，保持即時戰情同步
loadFinance();
setInterval(loadFinance, 2000);