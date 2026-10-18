-- sql-flow 演示数据（MySQL 版）。起好 MySQL 后执行：
--   mysql -u root < demo.sql
-- 然后在 sql-flow「数据源」里选 MySQL：主机 127.0.0.1 / 端口 3306 / 数据库 sqlflow_demo / 用户 root。
--
-- 表结构与 demo-sqlite.sql 一致（users / products / orders / order_items / order_notes），
-- 这样同一套工作流在 MySQL 和 SQLite 上都能跑。

CREATE DATABASE IF NOT EXISTS sqlflow_demo DEFAULT CHARACTER SET utf8mb4;
USE sqlflow_demo;

DROP TABLE IF EXISTS order_notes;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(64)  NOT NULL,
  city       VARCHAR(64)  NOT NULL,
  vip_level  INT          NOT NULL DEFAULT 0,   -- 0 普通 / 1 银卡 / 2 金卡
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id       BIGINT PRIMARY KEY AUTO_INCREMENT,
  name     VARCHAR(128)  NOT NULL,
  category VARCHAR(64)   NOT NULL,
  price    DECIMAL(10,2) NOT NULL,
  stock    INT           NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_no   VARCHAR(32)   NOT NULL,
  user_id    BIGINT        NOT NULL,
  status     VARCHAR(16)   NOT NULL,            -- paid / unpaid / refunded / cancelled
  amount     DECIMAL(10,2) NOT NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id   BIGINT        NOT NULL,
  product_id BIGINT        NOT NULL,
  qty        INT           NOT NULL,
  price      DECIMAL(10,2) NOT NULL
);

CREATE TABLE order_notes (
  id       BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT       NOT NULL,
  note     VARCHAR(200) NOT NULL
);

INSERT INTO users (name, city, vip_level) VALUES
  ('张三', '上海', 2), ('李四', '北京', 1), ('王五', '上海', 0), ('赵六', '深圳', 2),
  ('孙七', '杭州', 1), ('周八', '北京', 0), ('吴九', '成都', 0), ('郑十', '上海', 1);

INSERT INTO products (name, category, price, stock) VALUES
  ('无线耳机',    '数码',  399.00, 120),
  ('机械键盘',    '数码',  599.00,  45),
  ('显示器支架',  '办公',  159.00, 200),
  ('人体工学椅',  '办公', 1299.00,  18),
  ('咖啡豆 500g', '食品',   89.00, 300),
  ('保温杯',      '生活',  129.00,  80),
  ('蓝牙音箱',    '数码',  249.00,  60),
  ('笔记本支架',  '办公',   79.00, 150);

INSERT INTO orders (order_no, user_id, status, amount) VALUES
  ('A1001', 1, 'paid',       399.00), ('A1002', 1, 'paid',      1299.00),
  ('A1003', 2, 'unpaid',      89.00), ('A1004', 3, 'paid',       159.00),
  ('A1005', 4, 'paid',       599.00), ('A1006', 4, 'refunded',   249.00),
  ('A1007', 5, 'paid',        79.00), ('A1008', 6, 'cancelled',  129.00),
  ('A1009', 2, 'paid',       648.00), ('A1010', 7, 'unpaid',     399.00),
  ('A1011', 1, 'paid',        89.00), ('A1012', 8, 'paid',      1447.00),
  ('A1013', 3, 'refunded',    79.00), ('A1014', 5, 'paid',       848.00),
  ('A1015', 4, 'paid',       129.00), ('A1016', 7, 'paid',       249.00);

INSERT INTO order_items (order_id, product_id, qty, price) VALUES
  (1,1,1,399.00),(2,4,1,1299.00),(3,5,1,89.00),(4,3,1,159.00),
  (5,2,1,599.00),(6,7,1,249.00),(7,8,1,79.00),(8,6,1,129.00),
  (9,2,1,599.00),(9,5,1,89.00),(10,1,1,399.00),(11,5,1,89.00),
  (12,4,1,1299.00),(12,6,1,129.00),(13,8,1,79.00),(14,2,1,599.00),
  (14,7,1,249.00),(15,6,1,129.00),(16,7,1,249.00);

INSERT INTO order_notes (order_id, note) VALUES
  (2,  '大额订单，已人工复核'),
  (6,  '客户已退款：商品有瑕疵'),
  (8,  '客户主动取消'),
  (9,  '要求开公司发票'),
  (12, '金卡会员，已加急'),
  (13, '退款处理中'),
  (14, '分两件发出');
