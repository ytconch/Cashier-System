module.exports = {
  appName: '收銀系統',
  timezone: 'Asia/Taipei',
  dbFile: './data/cashier.db',
  systemKey: 'abc123456789',
  autoExpireMinutes: 30,
  users: {
    cashier: { username: 'cashier', password: 'cashier123', label: '收銀組' },
    ramen: { username: 'ramen', password: 'ramen123', label: '後勤-涼麵組' },
    haws: { username: 'haws', password: 'haws123', label: '後勤-糖葫蘆組' },
    counter: { username: 'counter', password: 'counter123', label: '櫃台組' },
    finance: { username: 'finance', password: 'finance123', label: '財務組' },
    admin: { username: 'admin', password: 'admin123', label: '管理員' }
  },
  prices: {
    ramen: {
      basePrice: 50,
      baseCost: 23,
      chicken: {
        none: { price: 0, cost: 0 },
        add: { price: 15, cost: 7 },
        double: { price: 30, cost: 14 }
      },
      sauce: {
        soy: { name: '醬油', price: 0, cost: 3 },
        sesame: { name: '胡麻醬', price: 0, cost: 4 }
      },
      spicy: {
        no: { name: '不加辣', price: 0, cost: 0 },
        yes: { name: '加辣', price: 0, cost: 1 }
      },
      eco: {
        no: { name: '沒環保餐具', price: 60, cost: 60 },
        yes: { name: '有環保餐具', price: -5, cost: 0 }
      }
    },
    haws: {
      types: {
        mix: { name: '混和', price: 40, cost: 17 },
        grape: { name: '全葡萄', price: 40, cost: 19 },
        tomato: { name: '全番茄', price: 35, cost: 9 }
      }
    },
    drinks: {
      items: {
        black: { name: '紅茶', price: 15, cost: 7 },
        green: { name: '綠茶', price: 15, cost: 7 },
        roselle: { name: '洛神花', price: 15, cost: 7 },
        winter: { name: '冬瓜茶', price: 15, cost: 7 }
      }
    }
  }
};