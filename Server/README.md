# Cashier System - Backend Server (後端核心與 API 服務)

> 📘 **專案完整架構與學術專案成果報告**：請參閱專案根目錄之 [完整 README.md](../README.md)。

## 系統版本說明 (v3 架構)
- **資安憑證代理注入**：前端不再硬編碼 `X-API-Key`，改由 Nginx 反向代理在轉發 `/api/` 時注入。
- **身分驗證自動識別**：登入頁僅需輸入帳號密碼，後端自動識別身分並簽發 SQLite Token Session。
- **路徑與部署相容性**：所有前端靜態資源與 HTML 改用相對路徑，支援子路徑與代理部署。

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