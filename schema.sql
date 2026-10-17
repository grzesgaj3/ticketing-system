CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(10)  NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
 
CREATE TABLE events (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(200)  NOT NULL,
    description TEXT,
    event_date  TIMESTAMPTZ   NOT NULL,
    price       NUMERIC(8,2)  NOT NULL CHECK (price >= 0)
);
 
CREATE TABLE seats (
    id          SERIAL PRIMARY KEY,
    section     VARCHAR(20) NOT NULL,
    row_num     INT         NOT NULL,
    seat_number INT         NOT NULL,
    UNIQUE (section, row_num, seat_number)
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
 
INSERT INTO seats (section, row_num, seat_number)
SELECT s.section, r, n
FROM (VALUES ('A'), ('B'), ('C')) AS s(section),
     generate_series(1, 10) AS r,
     generate_series(1, 12) AS n;