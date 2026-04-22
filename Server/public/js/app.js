const userBox = document.getElementById('userBox');
const moduleBox = document.getElementById('moduleBox');

function tile(title, desc, href) {
  return `
    <a class="role-tile" href="${href}">
      <div class="role-name">${esc(title)}</div>
      <div class="muted small">${esc(desc)}</div>
      <div class="pill">進入</div>
    </a>
  `;
}

function guard() {
  const role = currentRole();
  if (!role) {
    location.href = 'index.html';
    return false;
  }
  return true;
}

async function renderApp() {
  if (!guard()) return;

  const role = currentRole();
  const label = currentLabel();

  userBox.innerHTML = `
    <div>
      <div class="pill">${esc(label)}</div>
      <div class="muted small">帳號：${esc(role)}</div>
    </div>
    <div class="actions">
      <button class="secondary" onclick="location.href='index.html'">返回登入</button>
      <button class="ghost" onclick="logout()">登出</button>
    </div>
  `;

  const access = {
    cashier: [{ title: '收銀', desc: '建立訂單與點餐', href: 'cashier.html' }],
    kitchen_ramen: [{ title: '涼麵後勤', desc: '只看涼麵項目', href: 'kitchen-ramen.html' }],
    kitchen_haws: [{ title: '糖葫蘆後勤', desc: '只看糖葫蘆項目', href: 'kitchen-haws.html' }],
    counter: [{ title: '櫃台', desc: '叫號與領取', href: 'counter.html' }],
    finance: [{ title: '財務', desc: '趨勢與報表', href: 'finance.html' }],
    admin: [
      { title: '收銀', desc: '建立訂單與點餐', href: 'cashier.html' },
      { title: '涼麵後勤', desc: '只看涼麵項目', href: 'kitchen-ramen.html' },
      { title: '糖葫蘆後勤', desc: '只看糖葫蘆項目', href: 'kitchen-haws.html' },
      { title: '櫃台', desc: '叫號與領取', href: 'counter.html' },
      { title: '財務', desc: '趨勢與報表', href: 'finance.html' }
    ]
  }[role] || [];

  moduleBox.innerHTML = access.map(x => tile(x.title, x.desc, x.href)).join('');
}

renderApp();
