CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(10)  NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE arenas (
    id     SERIAL PRIMARY KEY,
    name   VARCHAR(100) NOT NULL UNIQUE,
    layout VARCHAR(10)  NOT NULL CHECK (layout IN ('theater', 'stadium'))
);

CREATE TABLE events (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(200)  NOT NULL,
    description TEXT,
    event_date  TIMESTAMPTZ   NOT NULL,
    price       NUMERIC(8,2)  NOT NULL CHECK (price >= 0),
     arena_id    INT           NOT NULL REFERENCES arenas(id)
);
 
CREATE TABLE seats (
    id          SERIAL PRIMARY KEY,
    arena_id    INT         NOT NULL REFERENCES arenas(id),
    section     VARCHAR(20) NOT NULL,
    row_num     INT         NOT NULL,
    seat_number INT         NOT NULL,
    UNIQUE (arena_id, section, row_num, seat_number)
);
 
CREATE TABLE orders (
    id         SERIAL PRIMARY KEY,
    user_id    INT           NOT NULL REFERENCES users(id),
    total      NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);
 
CREATE TABLE order_items (
    id       SERIAL PRIMARY KEY,
    order_id INT           NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    seat_id  INT           NOT NULL REFERENCES seats(id),
    price    NUMERIC(8,2)  NOT NULL,
    UNIQUE (event_id, seat_id)
);
 
INSERT INTO arenas (name, layout) VALUES
  ('Silesian Theater Hall', 'theater'),
  ('Visual Arena', 'stadium');

INSERT INTO seats (arena_id, section, row_num, seat_number)
SELECT a.id, s.section, r, n
FROM arenas a,
     (VALUES ('A'), ('B'), ('C')) AS s(section),
     generate_series(1, 10) AS r,
     generate_series(1, 12) AS n
WHERE a.name = 'Silesian Theater Hall';

INSERT INTO seats (arena_id, section, row_num, seat_number)
SELECT a.id, s.section, r, n
FROM arenas a,
     (VALUES ('A', 20), ('B', 10), ('C', 20), ('D', 10), ('E', 20)) AS s(section, per_row),
     generate_series(1, 10) AS r,
     generate_series(1, s.per_row) AS n
WHERE a.name = 'Visual Arena';

INSERT INTO seats (arena_id, section, row_num, seat_number)
SELECT id, 'FLOOR', 1, n FROM arenas, generate_series(1, 500) AS n
WHERE name = 'Visual Arena';