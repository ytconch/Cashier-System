const loginForm = document.getElementById('loginForm');
const roleSelect = document.getElementById('role');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const messageEl = document.getElementById('message');
const sessionBox = document.getElementById('sessionBox');
const roleTiles = document.getElementById('roleTiles');

function showTiles() {
  const role = currentRole();
  const label = currentLabel();
  if (!role) {
    sessionBox.innerHTML = '<div class="muted">尚未登入</div>';
  } else {
    sessionBox.innerHTML = `
      <div class="pill">${esc(label)}</div>
      <div class="muted small">已登入：${esc(role)}</div>
      <div class="actions">
        <button class="secondary" onclick="goApp()">進入主畫面</button>
        <button class="ghost" onclick="logout()">登出</button>
      </div>
    `;
  }

  const roles = Object.keys(ROLE_TEXT).filter((r) => r !== 'admin');
  roleTiles.innerHTML = roles.map((role) => {
    const canEnter = currentRole() === role || currentRole() === 'admin';
    const target = {
      cashier: 'cashier.html',
      kitchen_ramen: 'kitchen-ramen.html',
      kitchen_haws: 'kitchen-haws.html',
      counter: 'counter.html',
      finance: 'finance.html'
    }[role] || 'app.html';
    return `
      <div class="role-tile">
        <div class="role-name">${esc(ROLE_TEXT[role])}</div>
        <div class="muted small">${esc(target)}</div>
        <button class="secondary" ${canEnter ? '' : 'disabled'} onclick="location.href='${target}'">進入</button>
      </div>
    `;
  }).join('');
}

async function login() {
  messageEl.textContent = '';
  try {
    const data = await API.request('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        role: roleSelect.value,
        username: usernameEl.value.trim(),
        password: passwordEl.value.trim()
      })
    });
    setSession(data.token, data.role, data.label);
    messageEl.textContent = '登入成功';
    showTiles();
    setTimeout(() => location.href = 'app.html', 250);
  } catch (err) {
    messageEl.textContent = err.message;
  }
}

function goApp() {
  location.href = '/app.html';
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  login();
});

showTiles();
