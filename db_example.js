const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "ja mam ticketing, jak masz inną to daj swoją",
  user: "domyślnie postgres ewentualnie daj swój",
  password: "Tutaj wpisz swoje do postgresa okok?",
});

module.exports = pool;
