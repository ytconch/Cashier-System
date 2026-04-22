const form = document.getElementById('loginForm');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const messageEl = document.getElementById('message');
const sessionBox = document.getElementById('sessionBox');
const roleTiles = document.getElementById('roleTiles');

function renderSession() {
  const role = currentRole();
  const label = currentLabel();

  if (role) {
    sessionBox.innerHTML = `
      <div class="pill">${esc(label)}</div>
      <div class="muted small">目前登入：${esc(role)}</div>
      <div class="actions">
        <button class="secondary" onclick="location.href='app.html'">進入主畫面</button>
        <button class="ghost" onclick="logout()">登出</button>
      </div>
    `;
  } else {
    sessionBox.innerHTML = '<div class="empty-state">尚未登入</div>';
  }

  const tiles = [
    ['收銀組', 'cashier', 'cashier.html'],
    ['後勤-涼麵組', 'kitchen_ramen', 'kitchen-ramen.html'],
    ['後勤-糖葫蘆組', 'kitchen_haws', 'kitchen-haws.html'],
    ['櫃台組', 'counter', 'counter.html'],
    ['財務組', 'finance', 'finance.html']
  ];

  const isAdmin = currentRole() === 'admin';
  roleTiles.innerHTML = tiles.map(([title, role, href]) => `
    <a class="role-tile" href="${href}">
      <div class="role-name">${esc(title)}</div>
      <div class="muted small">${esc(href)}</div>
      <div class="pill">${isAdmin || currentRole() === role ? '可進入' : '登入後可用'}</div>
    </a>
  `).join('');
}

async function login() {
  messageEl.textContent = '';
  try {
    const data = await API.request('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: usernameEl.value.trim(),
        password: passwordEl.value.trim()
      })
    });
    setSession(data.token, data.role, data.label);
    messageEl.textContent = `登入成功：${data.label}`;
    setTimeout(() => location.href = 'app.html', 200);
  } catch (err) {
    messageEl.textContent = err.message;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  login();
});

renderSession();
