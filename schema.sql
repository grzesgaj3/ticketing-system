CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS arenas (
    id     INTEGER PRIMARY KEY,
    name   TEXT NOT NULL UNIQUE,
    layout TEXT NOT NULL CHECK (layout IN ('theater', 'stadium'))
);

CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    event_date  TEXT NOT NULL,
    price       REAL NOT NULL CHECK (price >= 0),
    arena_id    INTEGER NOT NULL REFERENCES arenas(id)
);

CREATE TABLE IF NOT EXISTS event_row_prices (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    row_num  INTEGER NOT NULL CHECK (row_num > 0),
    extra    REAL NOT NULL DEFAULT 0 CHECK (extra >= 0),
    PRIMARY KEY (event_id, row_num)
);

CREATE TABLE IF NOT EXISTS seats (
    id          INTEGER PRIMARY KEY,
    arena_id    INTEGER NOT NULL REFERENCES arenas(id),
    section     TEXT NOT NULL,
    row_num     INTEGER NOT NULL,
    seat_number INTEGER NOT NULL,
    UNIQUE (arena_id, section, row_num, seat_number)
);

CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    total      REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS order_items (
    id       INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    seat_id  INTEGER NOT NULL REFERENCES seats(id),
    price    REAL NOT NULL,
    UNIQUE (event_id, seat_id)
);

INSERT OR IGNORE INTO arenas (id, name, layout) VALUES
  (1, 'Silesian Theater Hall', 'theater'),
  (2, 'Visual Arena', 'stadium');

INSERT INTO seats (arena_id, section, row_num, seat_number)
WITH RECURSIVE
  rows(r) AS (SELECT 1 UNION ALL SELECT r+1 FROM rows WHERE r < 10),
  nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n < 12)
SELECT a.id, s.section, r.r, n.n
FROM arenas a
CROSS JOIN (SELECT 'A' AS section UNION ALL SELECT 'B' UNION ALL SELECT 'C') s
CROSS JOIN rows r
CROSS JOIN nums n
WHERE a.name = 'Silesian Theater Hall'
  AND NOT EXISTS (SELECT 1 FROM seats x WHERE x.arena_id = a.id);

INSERT INTO seats (arena_id, section, row_num, seat_number)
WITH RECURSIVE
  rows(r) AS (SELECT 1 UNION ALL SELECT r+1 FROM rows WHERE r < 10),
  nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n < 20)
SELECT a.id, s.section, r.r, n.n
FROM arenas a
CROSS JOIN (SELECT 'A' AS section UNION ALL SELECT 'C' UNION ALL SELECT 'E') s
CROSS JOIN rows r
CROSS JOIN nums n
WHERE a.name = 'Visual Arena'
  AND NOT EXISTS (SELECT 1 FROM seats x WHERE x.arena_id = a.id AND x.section IN ('A','C','E'));

INSERT INTO seats (arena_id, section, row_num, seat_number)
WITH RECURSIVE
  secs(section) AS (SELECT 'B' UNION ALL SELECT 'D'),
  rows(r) AS (SELECT 1 UNION ALL SELECT r+1 FROM rows WHERE r < 10),
  gen(section, row_num, seat_number) AS (
    SELECT s.section, r.r, 1 FROM secs s CROSS JOIN rows r
    UNION ALL
    SELECT section, row_num, seat_number+1 FROM gen WHERE seat_number < row_num
  )
SELECT a.id, g.section, g.row_num, g.seat_number
FROM arenas a CROSS JOIN gen g
WHERE a.name = 'Visual Arena'
  AND NOT EXISTS (SELECT 1 FROM seats x WHERE x.arena_id = a.id AND x.section IN ('B','D'));

INSERT INTO seats (arena_id, section, row_num, seat_number)
WITH RECURSIVE
  nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n < 500)
SELECT a.id, 'FLOOR', 1, n.n
FROM arenas a CROSS JOIN nums n
WHERE a.name = 'Visual Arena'
  AND NOT EXISTS (SELECT 1 FROM seats x WHERE x.arena_id = a.id AND x.section = 'FLOOR');