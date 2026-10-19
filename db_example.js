const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

// Copy this file to db.js and adjust if needed.
const dbPath = path.join(__dirname, "ticketing.db");
const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA cache_size = -64000");
db.exec("PRAGMA temp_store = MEMORY");

// Create schema + seed data on first run.
const hasUsers = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
  .get();
if (!hasUsers) {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
}

const DATE_KEYS = new Set(["event_date", "created_at"]);

function normalizeRow(row) {
  const out = {};
  for (const key of Object.keys(row)) {
    if (DATE_KEYS.has(key) && row[key] != null) {
      out[key] = new Date(row[key]);
    } else {
      out[key] = row[key];
    }
  }
  return out;
}

function normalizeError(err) {
  if (err && (err.errcode === 2067 || /UNIQUE constraint failed/i.test(err.message || ""))) {
    const e = new Error(err.message);
    e.code = "SQLITE_CONSTRAINT_UNIQUE";
    throw e;
  }
  throw err;
}

function query(sql, params = []) {
  const trimmed = String(sql).trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)(\s|$)/i.test(trimmed)) {
    db.exec(trimmed);
    return { rows: [], rowCount: 0 };
  }
  try {
    const stmt = db.prepare(sql);
    if (/\bRETURNING\b/i.test(sql) || /^\s*(SELECT|WITH|EXPLAIN|PRAGMA)/i.test(sql)) {
      const rows = stmt.all(...params).map(normalizeRow);
      return { rows, rowCount: rows.length };
    }
    const info = stmt.run(...params);
    return { rows: [], rowCount: info.changes };
  } catch (err) {
    normalizeError(err);
  }
}

function connect() {
  return {
    query,
    release() {},
  };
}

const pool = { query, connect };
module.exports = pool;