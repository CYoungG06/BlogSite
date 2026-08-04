-- 全站访客统计:PV 总量放 kv;独立访客按浏览器匿名 vid 一行
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visitors (
  vid TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  visits INTEGER NOT NULL DEFAULT 1
);
