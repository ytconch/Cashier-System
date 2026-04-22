PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'waiting',           -- waiting, preparing, ready, picked_up, canceled, expired
  pickup_state TEXT NOT NULL DEFAULT 'normal',      -- normal, unclaimed
  ramen_required INTEGER NOT NULL DEFAULT 0,
  haws_required INTEGER NOT NULL DEFAULT 0,
  ramen_done INTEGER NOT NULL DEFAULT 0,
  haws_done INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  total_cost INTEGER NOT NULL DEFAULT 0,
  profit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  category TEXT NOT NULL,                -- ramen, haws, drink
  item_key TEXT NOT NULL,
  item_name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  cost_total INTEGER NOT NULL,
  options_json TEXT NOT NULL DEFAULT '{}',
  display_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT,
  changed_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS production_state (
  component TEXT PRIMARY KEY,            -- ramen, haws
  prepared_count INTEGER NOT NULL DEFAULT 0,
  sold_out INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS production_inventory (
  component TEXT NOT NULL,               -- ramen, haws
  item_key TEXT NOT NULL,                -- ramen, mix, grape, tomato
  prepared_count INTEGER NOT NULL DEFAULT 0,
  sold_out INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (component, item_key)
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_no ON orders(order_no);
CREATE INDEX IF NOT EXISTS idx_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_category_created ON order_items(category, created_at);
