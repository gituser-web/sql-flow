-- sql-flow 演示数据（SQLite）。macOS 自带 sqlite3，也可以直接用已经生成好的 data/demo.db。
-- 手动重建：（在项目根目录）sqlite3 data/demo.db < demo-sqlite.sql
--
-- 表：
--   users        用户（城市、会员等级）
--   products     商品（分类、价格、库存）
--   orders       订单（属于哪个用户、状态、金额）
--   order_items  订单明细（订单 ↔ 商品）
--   order_notes  订单备注
-- 典型用法：第 1 层查 VIP 用户的订单 → 条件判断 → 第 2 层用第 1 层的 id 去查明细/备注。

DROP TABLE IF EXISTS order_notes;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  city       TEXT NOT NULL,
  vip_level  INTEGER NOT NULL DEFAULT 0,   -- 0 普通 / 1 银卡 / 2 金卡
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  category TEXT NOT NULL,
  price    REAL NOT NULL,
  stock    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no   TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  status     TEXT NOT NULL,                -- paid / unpaid / refunded / cancelled
  amount     REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty        INTEGER NOT NULL,
  price      REAL NOT NULL
);

CREATE TABLE order_notes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  note     TEXT NOT NULL
);

-- ── 数据 ──────────────────────────────────────────────────────────
INSERT INTO users (name, city, vip_level) VALUES
  ('张三', '上海', 2),
  ('李四', '北京', 1),
  ('王五', '上海', 0),
  ('赵六', '深圳', 2),
  ('孙七', '杭州', 1),
  ('周八', '北京', 0),
  ('吴九', '成都', 0),
  ('郑十', '上海', 1);

INSERT INTO products (name, category, price, stock) VALUES
  ('无线耳机',   '数码', 399.00, 120),
  ('机械键盘',   '数码', 599.00,  45),
  ('显示器支架', '办公', 159.00, 200),
  ('人体工学椅', '办公', 1299.00, 18),
  ('咖啡豆 500g','食品',  89.00, 300),
  ('保温杯',     '生活', 129.00,  80),
  ('蓝牙音箱',   '数码', 249.00,  60),
  ('笔记本支架', '办公',  79.00, 150);

INSERT INTO orders (order_no, user_id, status, amount) VALUES
  ('A1001', 1, 'paid',      399.00),
  ('A1002', 1, 'paid',     1299.00),
  ('A1003', 2, 'unpaid',     89.00),
  ('A1004', 3, 'paid',      159.00),
  ('A1005', 4, 'paid',      599.00),
  ('A1006', 4, 'refunded',  249.00),
  ('A1007', 5, 'paid',       79.00),
  ('A1008', 6, 'cancelled', 129.00),
  ('A1009', 2, 'paid',      648.00),
  ('A1010', 7, 'unpaid',    399.00),
  ('A1011', 1, 'paid',       89.00),
  ('A1012', 8, 'paid',     1447.00),
  ('A1013', 3, 'refunded',   79.00),
  ('A1014', 5, 'paid',      848.00),
  ('A1015', 4, 'paid',      129.00),
  ('A1016', 7, 'paid',      249.00);

INSERT INTO order_items (order_id, product_id, qty, price) VALUES
  (1,  1, 1,  399.00),
  (2,  4, 1, 1299.00),
  (3,  5, 1,   89.00),
  (4,  3, 1,  159.00),
  (5,  2, 1,  599.00),
  (6,  7, 1,  249.00),
  (7,  8, 1,   79.00),
  (8,  6, 1,  129.00),
  (9,  2, 1,  599.00),
  (9,  5, 1,   89.00),
  (10, 1, 1,  399.00),
  (11, 5, 1,   89.00),
  (12, 4, 1, 1299.00),
  (12, 6, 1,  129.00),
  (13, 8, 1,   79.00),
  (14, 2, 1,  599.00),
  (14, 7, 1,  249.00),
  (15, 6, 1,  129.00),
  (16, 7, 1,  249.00);

INSERT INTO order_notes (order_id, note) VALUES
  (2,  '大额订单，已人工复核'),
  (6,  '客户已退款：商品有瑕疵'),
  (8,  '客户主动取消'),
  (9,  '要求开公司发票'),
  (12, '金卡会员，已加急'),
  (13, '退款处理中'),
  (14, '分两件发出');
