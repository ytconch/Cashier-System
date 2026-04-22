# 收銀系統 v3

## 這版修正
- 前端不再硬塞 API key
- API key 改由 nginx 代理時注入
- 登入改成「帳號 + 密碼」自動辨識角色
- 登入頁只負責登入，不再先選角色
- 主畫面只顯示登入後可進入的區域

## 啟動
```bash
npm install
npm start
```

## 預設帳號
- 收銀組：`cashier / cashier123`
- 涼麵組：`ramen / ramen123`
- 糖葫蘆組：`haws / haws123`
- 櫃台組：`counter / counter123`
- 財務組：`finance / finance123`
- 管理員：`admin / admin123`

## 重要
`config.js` 的 `systemKey` 請改成長隨機字串，並讓 nginx 在 `/api/` 代理時代送同一把 key。


## 路徑
HTML 內已改成相對路徑，不再使用前導 `/`。