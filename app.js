const express = require("express");
const pool = require("./db");

const app = express();

app.set("view engine", "ejs");

const session = require("express-session");
const bcrypt = require("bcrypt");

app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: "change-this-to-any-long-random-text",
    resave: false,
    saveUninitialized: false,
  }),
);
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.get("/", (req, res) => {
  res.render("home");
});

app.get("/events", async (req, res) => {
  const result = await pool.query(
    "SELECT id, title, event_date, price FROM events ORDER BY event_date",
  );
  res.render("index", { events: result.rows });
});

app.get("/events/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM events WHERE id = $1", [
    req.params.id,
  ]);
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
  const eventResult = await pool.query("SELECT * FROM events WHERE id = $1", [
    req.params.id,
  ]);
  if (eventResult.rows.length === 0) {
    return res.status(404).send("Event not found");
  }

  const seatsResult = await pool.query(
    `SELECT s.id, s.section, s.row_num, s.seat_number,
            (oi.id IS NOT NULL) AS taken
     FROM seats s
     LEFT JOIN order_items oi ON oi.seat_id = s.id AND oi.event_id = $1
     ORDER BY s.section, s.row_num, s.seat_number`,
    [req.params.id],
  );

  const sections = {};
  seatsResult.rows.forEach((seat) => {
    sections[seat.section] ??= {};
    (sections[seat.section][seat.row_num] ??= []).push(seat);
  });

  res.render("seats", { event: eventResult.rows[0], sections });
});

function toSeatIds(body) {
  if (!body.seats) return [];
  return [].concat(body.seats).map(Number); // one seat arrives as a string, several as an array
}

app.post("/events/:id/checkout", requireLogin, async (req, res) => {
  const seatIds = toSeatIds(req.body);
  if (seatIds.length === 0)
    return res.redirect(`/events/${req.params.id}/seats`);

  const eventResult = await pool.query("SELECT * FROM events WHERE id = $1", [
    req.params.id,
  ]);
  if (eventResult.rows.length === 0)
    return res.status(404).send("Event not found");

  const seatsResult = await pool.query(
    `SELECT id, section, row_num, seat_number FROM seats
     WHERE id = ANY($1) ORDER BY section, row_num, seat_number`,
    [seatIds],
  );

  const event = eventResult.rows[0];
  const total = (Number(event.price) * seatsResult.rows.length).toFixed(2);
  res.render("checkout", { event, seats: seatsResult.rows, total });
});

app.post("/events/:id/book", requireLogin, async (req, res) => {
  const seatIds = toSeatIds(req.body);
  if (seatIds.length === 0)
    return res.redirect(`/events/${req.params.id}/seats`);

  const eventResult = await pool.query("SELECT * FROM events WHERE id = $1", [
    req.params.id,
  ]);
  if (eventResult.rows.length === 0)
    return res.status(404).send("Event not found");

  const price = eventResult.rows[0].price;
  const total = (Number(price) * seatIds.length).toFixed(2);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query(
      "INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING id",
      [req.session.user.id, total],
    );
    for (const seatId of seatIds) {
      await client.query(
        "INSERT INTO order_items (order_id, event_id, seat_id, price) VALUES ($1, $2, $3, $4)",
        [order.rows[0].id, req.params.id, seatId, price],
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

  // group rows by order
  const orders = {};
  result.rows.forEach((row) => {
    orders[row.order_id] ??= {
      id: row.order_id,
      total: row.total,
      created_at: row.created_at,
      title: row.title,
      event_date: row.event_date,
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

app.get("/admin/events/new", requireAdmin, (req, res) => {
  res.render("event_form", { event: null, dateValue: "" });
});

app.post("/admin/events", requireAdmin, async (req, res) => {
  const { title, description, event_date, price } = req.body;
  await pool.query(
    "INSERT INTO events (title, description, event_date, price) VALUES ($1, $2, $3, $4)",
    [title, description, event_date, price],
  );
  res.redirect("/");
});

app.get("/admin/events/:id/edit", requireAdmin, async (req, res) => {
  const result = await pool.query("SELECT * FROM events WHERE id = $1", [
    req.params.id,
  ]);
  if (result.rows.length === 0) return res.status(404).send("Event not found");
  const event = result.rows[0];
  // convert the date to the format <input type="datetime-local"> expects
  const d = event.event_date;
  const dateValue = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  res.render("event_form", { event, dateValue });
});

app.post("/admin/events/:id/edit", requireAdmin, async (req, res) => {
  const { title, description, event_date, price } = req.body;
  await pool.query(
    "UPDATE events SET title = $1, description = $2, event_date = $3, price = $4 WHERE id = $5",
    [title, description, event_date, price, req.params.id],
  );
  res.redirect("/events");
});

app.post("/admin/events/:id/delete", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM events WHERE id = $1", [req.params.id]);
  res.redirect("/events");
});

app.get("/admin/orders", requireAdmin, async (req, res) => {
  const result = await pool.query(
    `SELECT o.id, o.total, o.created_at, u.email, e.title,
            string_agg('Sec ' || s.section || ', row ' || s.row_num || ', seat ' || s.seat_number,
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

app.listen(3000, () => console.log("http://localhost:3000"));
