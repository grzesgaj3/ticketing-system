const express = require("express");
const pool = require("./db");

const app = express();

app.set("view engine", "ejs");

const path = require('path');
app.set('views', path.join(__dirname, 'views'));

const session = require("express-session");
const bcrypt = require("bcrypt");

app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: "secret-secret-secret",
    resave: false,
    saveUninitialized: false,
  }),
);

app.param("id", (req, res, next, id) => {
  if (!/^\d{1,9}$/.test(id)) {
    return res
      .status(404)
      .render("error", { status: 404, message: "Page not found" });
  }
  next();
});

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.get("/", (req, res) => {
  res.render("home");
});

app.get("/events", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const result = await pool.query(
    `SELECT e.id, e.title, e.event_date,
            MIN(e.price + CASE WHEN s.section = 'FLOOR' THEN 0
                               ELSE COALESCE(erp.extra, 0) END) AS min_price
     FROM events e
     LEFT JOIN seats s ON s.arena_id = e.arena_id
       AND NOT EXISTS (SELECT 1 FROM order_items oi
                       WHERE oi.seat_id = s.id AND oi.event_id = e.id)
     LEFT JOIN event_row_prices erp ON erp.event_id = e.id AND erp.row_num = s.row_num
     WHERE e.title ILIKE $1
     GROUP BY e.id
     ORDER BY e.event_date`,
    [`%${q}%`],
  );
  res.render("index", { events: result.rows, q });
});

app.get("/events/:id", async (req, res) => {
  const result = await pool.query(
    `SELECT e.*,
            MIN(e.price + CASE WHEN s.section = 'FLOOR' THEN 0
                               ELSE COALESCE(erp.extra, 0) END) AS min_price
     FROM events e
     LEFT JOIN seats s ON s.arena_id = e.arena_id
       AND NOT EXISTS (SELECT 1 FROM order_items oi
                       WHERE oi.seat_id = s.id AND oi.event_id = e.id)
     LEFT JOIN event_row_prices erp ON erp.event_id = e.id AND erp.row_num = s.row_num
     WHERE e.id = $1
     GROUP BY e.id`,
    [req.params.id],
  );
  if (result.rows.length === 0) {
    return res.status(404).send("Event not found");
  }
  res.render("event", { event: result.rows[0] });
});

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

app.get("/events/:id/seats", requireLogin, async (req, res) => {
  const eventResult = await pool.query(
    `SELECT e.*, a.name AS arena_name, a.layout
     FROM events e JOIN arenas a ON a.id = e.arena_id
     WHERE e.id = $1`,
    [req.params.id],
  );
  if (eventResult.rows.length === 0) {
    return res.status(404).send("Event not found");
  }
  const event = eventResult.rows[0];

  const seatsResult = await pool.query(
    `SELECT s.id, s.section, s.row_num, s.seat_number,
            (oi.id IS NOT NULL) AS taken,
            e.price + COALESCE(erp.extra, 0) AS price
     FROM seats s
     JOIN events e ON e.id = $1
     LEFT JOIN order_items oi ON oi.seat_id = s.id AND oi.event_id = e.id
     LEFT JOIN event_row_prices erp ON erp.event_id = e.id AND erp.row_num = s.row_num
     WHERE s.arena_id = e.arena_id
     ORDER BY s.section, s.row_num, s.seat_number`,
    [req.params.id],
  );

  const sections = {};
  let floorFree = 0;
  seatsResult.rows.forEach((seat) => {
    if (seat.section === "FLOOR") {
      if (!seat.taken) floorFree++;
      return;
    }
    sections[seat.section] ??= {};
    (sections[seat.section][seat.row_num] ??= []).push(seat);
  });

  // one color per distinct price, cheapest first
  const palette = ["#66bb6a", "#64b5f6", "#ffd54f", "#ba68c8", "#4dd0e1",
                   "#f06292", "#ffa726", "#d63330", "#f36532", "#d4e157"];
  const prices = [...new Set(
    seatsResult.rows.filter((s) => s.section !== "FLOOR").map((s) => s.price),
  )].sort((a, b) => a - b);
  const priceColors = {};
  prices.forEach((p, i) => (priceColors[p] = palette[i % palette.length]));

  res.render("seats", { event, sections, floorFree, priceColors });
});

function toSeatIds(body) {
  if (!body.seats) return [];
  return [].concat(body.seats).map(Number); 
}

function toFloorCount(body) {
  const n = Number(body.floor);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function getSeatPrices(db, eventId, seatIds) {
  return db.query(
    `SELECT s.id, s.section, s.row_num, s.seat_number,
            e.price + COALESCE(erp.extra, 0) AS price
     FROM seats s
     JOIN events e ON e.id = $1 AND e.arena_id = s.arena_id
     LEFT JOIN event_row_prices erp
       ON erp.event_id = e.id AND erp.row_num = s.row_num AND s.section <> 'FLOOR'
     WHERE s.id = ANY($2)
     ORDER BY s.section, s.row_num, s.seat_number`,
    [eventId, seatIds],
  );
}

app.post("/events/:id/checkout", requireLogin, async (req, res) => {
  const seatIds = toSeatIds(req.body);
  const floor = toFloorCount(req.body);
  if (seatIds.length === 0 && floor === 0)
    return res.redirect(`/events/${req.params.id}/seats`);

  const eventResult = await pool.query("SELECT * FROM events WHERE id = $1", [
    req.params.id,
  ]);
  if (eventResult.rows.length === 0)
    return res.status(404).send("Event not found");

  const seatsResult = await getSeatPrices(pool, req.params.id, seatIds);

  const event = eventResult.rows[0];
  const seatsTotal = seatsResult.rows.reduce((sum, s) => sum + Number(s.price), 0);
  const total = (seatsTotal + Number(event.price) * floor).toFixed(2);
  res.render("checkout", { event, seats: seatsResult.rows, floor, total });
});

app.post("/events/:id/book", requireLogin, async (req, res) => {
  const seatIds = toSeatIds(req.body);
  const floor = toFloorCount(req.body);
  if (seatIds.length === 0 && floor === 0)
    return res.redirect(`/events/${req.params.id}/seats`);

  const eventResult = await pool.query("SELECT * FROM events WHERE id = $1", [
    req.params.id,
  ]);
  if (eventResult.rows.length === 0)
    return res.status(404).send("Event not found");
  const event = eventResult.rows[0];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (floor > 0) {
      const free = await client.query(
        `SELECT s.id FROM seats s
         WHERE s.arena_id = $1 AND s.section = 'FLOOR'
           AND NOT EXISTS (SELECT 1 FROM order_items oi
                           WHERE oi.seat_id = s.id AND oi.event_id = $2)
         ORDER BY s.id LIMIT $3`,
        [event.arena_id, req.params.id, floor],
      );
      if (free.rows.length < floor) {
        await client.query("ROLLBACK");
        return res.status(409).send(
          `Sorry, not enough floor tickets left. <a href="/events/${req.params.id}/seats">Choose again</a>`,
        );
      }
      free.rows.forEach((r) => seatIds.push(r.id));
    }

    const seats = (await getSeatPrices(client, req.params.id, seatIds)).rows;
    const total = seats.reduce((sum, s) => sum + Number(s.price), 0).toFixed(2);
    const order = await client.query(
      "INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING id",
      [req.session.user.id, total],
    );
    for (const seat of seats) {
      await client.query(
        "INSERT INTO order_items (order_id, event_id, seat_id, price) VALUES ($1, $2, $3, $4)",
        [order.rows[0].id, req.params.id, seat.id, seat.price],
      );
    }
    await client.query("COMMIT");
    res.redirect("/orders");
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res
        .status(409)
        .send(
          `Sorry, one of those seats was just taken. <a href="/events/${req.params.id}/seats">Choose again</a>`,
        );
    }
    throw err;
  } finally {
    client.release();
  }
});

app.get("/orders", requireLogin, async (req, res) => {
  const result = await pool.query(
    `SELECT o.id AS order_id, o.total, o.created_at,
            e.title, e.event_date,
            s.section, s.row_num, s.seat_number
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN events e ON e.id = oi.event_id
     JOIN seats s ON s.id = oi.seat_id
     WHERE o.user_id = $1
     ORDER BY o.created_at DESC, s.section, s.row_num, s.seat_number`,
    [req.session.user.id],
  );

  app.post("/orders/:id/cancel", requireLogin, async (req, res) => {
  const result = await pool.query(
    `DELETE FROM orders o
     WHERE o.id = $1 AND o.user_id = $2
       AND EXISTS (
         SELECT 1 FROM order_items oi
         JOIN events e ON e.id = oi.event_id
         WHERE oi.order_id = o.id AND e.event_date > now() + interval '7 days'
       )
     RETURNING o.id`,
    [req.params.id, req.session.user.id],
  );
  if (result.rowCount === 0) {
    return res.status(400).render("error", {
      status: 400,
      message: "This order can't be cancelled",
    });
  }
  res.redirect("/orders");
});

  // group rows by order
  const orders = {};
  result.rows.forEach((row) => {
    orders[row.order_id] ??= {
      id: row.order_id,
      total: row.total,
      created_at: row.created_at,
      title: row.title,
      event_date: row.event_date,
      can_cancel: row.event_date.getTime() - Date.now() > 7 * 24 * 60 * 60 * 1000,
      seats: [],
    };
    orders[row.order_id].seats.push(row);
  });

  res.render("orders", { orders: Object.values(orders).reverse() });
});

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin")
    return res.status(403).send("Admins only");
  next();
}

async function getRowCount() {
  const result = await pool.query(
    "SELECT MAX(row_num) AS max FROM seats WHERE section <> 'FLOOR'",
  );
  return result.rows[0].max || 0;
}

async function saveRowPrices(eventId, body) {
  const rowCount = await getRowCount();
  await pool.query("DELETE FROM event_row_prices WHERE event_id = $1", [eventId]);
  for (let r = 1; r <= rowCount; r++) {
    const extra = Number(body["extra_" + r]);
    if (extra > 0) {
      await pool.query(
        "INSERT INTO event_row_prices (event_id, row_num, extra) VALUES ($1, $2, $3)",
        [eventId, r, extra],
      );
    }
  }
}

app.get("/admin/events/new", requireAdmin, async (req, res) => {
  const arenas = await pool.query("SELECT id, name FROM arenas ORDER BY name");
  const rowCount = await getRowCount();
  res.render("event_form", {
    event: null, dateValue: "", arenas: arenas.rows, rowCount, extras: {},
  });
});

app.post("/admin/events", requireAdmin, async (req, res) => {
  const { title, description, event_date, price, arena_id } = req.body;
  const result = await pool.query(
    "INSERT INTO events (title, description, event_date, price, arena_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [title, description, event_date, price, arena_id],
  );
  await saveRowPrices(result.rows[0].id, req.body);
  res.redirect("/events");
});

app.get("/admin/events/:id/edit", requireAdmin, async (req, res) => {
  const result = await pool.query("SELECT * FROM events WHERE id = $1", [
    req.params.id,
  ]);
  if (result.rows.length === 0) return res.status(404).send("Event not found");
  const event = result.rows[0];
  const arenas = await pool.query("SELECT id, name FROM arenas ORDER BY name");
  // convert the date to the format <input type="datetime-local"> expects
  const d = event.event_date;
  const dateValue = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
    const extrasResult = await pool.query(
    "SELECT row_num, extra FROM event_row_prices WHERE event_id = $1",
    [req.params.id],
  );
  const extras = {};
  extrasResult.rows.forEach((r) => (extras[r.row_num] = r.extra));
  const rowCount = await getRowCount();
  res.render("event_form", { event, dateValue, arenas: arenas.rows, rowCount, extras });
});

app.post("/admin/events/:id/edit", requireAdmin, async (req, res) => {
  const { title, description, event_date, price, arena_id } = req.body;
  await pool.query(
    "UPDATE events SET title = $1, description = $2, event_date = $3, price = $4, arena_id = $5 WHERE id = $6",
    [title, description, event_date, price, arena_id, req.params.id],
  );
  await saveRowPrices(req.params.id, req.body);
  res.redirect("/events");
});

app.post("/admin/events/:id/delete", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM events WHERE id = $1", [req.params.id]);
  res.redirect("/events");
});

app.get("/admin/orders", requireAdmin, async (req, res) => {
  const result = await pool.query(
    `SELECT o.id, o.total, o.created_at, u.email, e.title,
            string_agg(CASE WHEN s.section = 'FLOOR' THEN 'Floor'
                ELSE 'Sec ' || s.section || ', row ' || s.row_num || ', seat ' || s.seat_number END,
           '; ' ORDER BY s.section, s.row_num, s.seat_number) AS seats
     FROM orders o
     JOIN users u ON u.id = o.user_id
     JOIN order_items oi ON oi.order_id = o.id
     JOIN events e ON e.id = oi.event_id
     JOIN seats s ON s.id = oi.seat_id
     GROUP BY o.id, u.email, e.title
     ORDER BY o.created_at DESC`,
  );
  res.render("admin_orders", { orders: result.rows });
});

app.post("/admin/orders/:id/cancel", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM orders WHERE id = $1", [req.params.id]);
  res.redirect("/admin/orders");
});

app.get("/register", (req, res) => res.render("register", { error: null }));

app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2)",
      [email, hash],
    );
    res.redirect("/login");
  } catch (err) {
    if (err.code === "23505") {
      return res.render("register", { error: "Email already registered" });
    }
    throw err;
  }
});

app.get("/login", (req, res) => res.render("login", { error: null }));

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [
    email,
  ]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.render("login", { error: "Wrong email or password" });
  }
  req.session.user = { id: user.id, email: user.email, role: user.role };
  res.redirect("/events");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res
    .status(500)
    .render("error", { status: 500, message: "Something went wrong" });
});

app.listen(3000, () => console.log("http://localhost:3000"));
