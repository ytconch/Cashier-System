const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const http = require('http');

// Use isolated temporary database for test
const testDbDir = path.join(__dirname, '..', 'data');
const testDbFile = path.join(testDbDir, 'test-smoke.db');
if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
if (fs.existsSync(testDbFile + '-wal')) fs.unlinkSync(testDbFile + '-wal');
if (fs.existsSync(testDbFile + '-shm')) fs.unlinkSync(testDbFile + '-shm');

const config = require('../config');
config.dbFile = './data/test-smoke.db';
config.systemKey = 'test-secret-key-12345';
config.autoExpireMinutes = 9999;

const TEST_PORT = 19876;
process.env.PORT = String(TEST_PORT);

// Require server to start it
require('../server');

const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const API_KEY = 'test-secret-key-12345';
const tokens = {};

async function req(route, method = 'GET', data = null, role = null) {
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY
  };
  if (role && tokens[role]) {
    headers['X-Session-Token'] = tokens[role];
  }

  const res = await fetch(`${BASE_URL}${route}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function runTests() {
  console.log('🚀 開始執行收銀系統端到端合約測試 (Smoke Test Suite)...');
  
  // 1. 角色登入並獲取 Token
  for (const [role, user] of Object.entries(config.users)) {
    const loginRes = await req('/api/login', 'POST', {
      username: user.username,
      password: user.password
    });
    assert.ok(loginRes.token, `登入角色 ${role} 失敗`);
    tokens[role] = loginRes.token;
  }
  console.log('✅ [1/7] 全角色 (cashier, ramen, haws, counter, finance, admin) 認證通過');

  // 2. 建單與計價防竄改 (涼麵 + 糖葫蘆)
  const orderRes = await req('/api/orders', 'POST', {
    items: [
      {
        category: 'ramen',
        itemKey: 'ramen',
        qty: 1,
        options: { chicken: 'none', sauce: 'soy', spicy: false, eco: true, cucumber: true, carrot: true },
        clientTamperedPrice: 1 // 模擬前端竄改金額攻擊
      },
      {
        category: 'haws',
        itemKey: 'mix',
        qty: 1,
        options: { type: 'mix' }
      }
    ]
  }, 'cashier');

  const orderId = orderRes.orderId || orderRes.order?.id;
  assert.ok(orderId, '建單未返回訂單 ID');

  const allOrders = (await req('/api/orders', 'GET', null, 'cashier')).orders;
  const createdOrder = allOrders.find(o => o.id === orderId);
  assert.ok(createdOrder, '訂單未在資料庫中查得');
  assert.equal(createdOrder.total_amount, 85, '計價錯誤：涼麵 (50-5=45) + 糖葫蘆 (40) 應為 85 元（防竄改成功）');
  assert.equal(createdOrder.items.length, 2, '訂單明細數量應為 2');
  console.log('✅ [2/7] 服務端防竄改計價與交易原子性通過 (85元 / 2品項)');

  // 3. 廚房分流佇列
  const ramenQueue = (await req('/api/kitchen/queue', 'GET', null, 'ramen')).orders;
  const ramenOrder = ramenQueue.find(o => o.id === orderId);
  assert.ok(ramenOrder, '涼麵組未收到訂單');
  assert.ok(ramenOrder.items.every(i => i.category === 'ramen'), '涼麵組佇列混入非涼麵品項');

  const hawsQueue = (await req('/api/kitchen/queue', 'GET', null, 'haws')).orders;
  const hawsOrder = hawsQueue.find(o => o.id === orderId);
  assert.ok(hawsOrder, '糖葫蘆組未收到訂單');
  assert.ok(hawsOrder.items.every(i => i.category === 'haws'), '糖葫蘆組佇列混入非糖葫蘆品項');
  console.log('✅ [3/7] 廚房工作站異質工序分流佇列通過');

  // 4. 混合訂單狀態機聚合 (Dual-Station State Convergence)
  let updateRamen = await req(`/api/orders/${orderId}/component`, 'PATCH', { component: 'ramen', done: true }, 'ramen');
  assert.equal(updateRamen.order.status, 'preparing', '單一組別完工時整單應維持 preparing');

  let updateHaws = await req(`/api/orders/${orderId}/component`, 'PATCH', { component: 'haws', done: true }, 'haws');
  assert.equal(updateHaws.order.status, 'ready', '兩組皆完工時整單狀態應躍遷為 ready');
  console.log('✅ [4/7] 雙站點非同步匯流有限狀態機判定通過 (preparing -> ready)');

  // 5. 逆向退回重新製作旗標隔離 (Rework Pipeline & Flag Isolation)
  const returnRes = await req(`/api/orders/${orderId}/return`, 'POST', {
    component: 'ramen',
    reason: '顧客反映需補加紅蘿蔔'
  }, 'counter');
  assert.equal(returnRes.order.ramen_done, 0, '涼麵完工旗標應被重設為 0');
  assert.equal(returnRes.order.haws_done, 1, '糖葫蘆完工旗標應維持為 1');
  assert.equal(returnRes.order.status, 'waiting', '退回後整單應回退至 waiting');

  // 重新補做涼麵
  const reworkDone = await req(`/api/orders/${orderId}/component`, 'PATCH', { component: 'ramen', done: true }, 'ramen');
  assert.equal(reworkDone.order.status, 'ready', '重新製作完工後應無縫恢復 ready');
  console.log('✅ [5/7] 逆向退回重做與獨立旗標保護機制通過');

  // 6. 出餐櫃台標記交付與顧客免登入即時查單
  await req(`/api/orders/${orderId}/status`, 'PATCH', { status: 'picked_up' }, 'counter');
  const customerView = await req(`/api/customer/${createdOrder.order_no}`, 'GET');
  assert.equal(customerView.order.status, 'picked_up', '顧客查單狀態應為 picked_up');
  console.log('✅ [6/7] 櫃台取餐交付與顧客免登入查單同步通過');

  // 7. 純飲料免廚房直出 (Instant Ready for Beverages)
  const drinkRes = await req('/api/orders', 'POST', {
    items: [{ category: 'drink', itemKey: 'black', qty: 1, options: {} }]
  }, 'cashier');
  const drinkOrder = (await req('/api/orders', 'GET', null, 'cashier')).orders.find(o => o.id === (drinkRes.orderId || drinkRes.order?.id));
  assert.equal(drinkOrder.total_amount, 15, '紅茶價格應為 15 元');
  assert.equal(drinkOrder.status, 'ready', '純飲料訂單應直接為 ready');
  console.log('✅ [7/7] 純飲料即時就緒機制通過 (15元 / 直出 ready)');

  console.log('\n🎉 所有 7 項系統核心合約與狀態機測試 100% 通過！');
  
  // Cleanup test database
  setTimeout(() => {
    try {
      if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
      if (fs.existsSync(testDbFile + '-wal')) fs.unlinkSync(testDbFile + '-wal');
      if (fs.existsSync(testDbFile + '-shm')) fs.unlinkSync(testDbFile + '-shm');
    } catch (_) {}
    process.exit(0);
  }, 300);
}

runTests().catch((err) => {
  console.error('\n❌ 測試未通過：', err);
  process.exit(1);
});
