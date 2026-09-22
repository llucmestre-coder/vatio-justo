-- Base de dades D1 «vatio-justo-leads»: contactes de la calculadora per fer-ne seguiment.
-- S'aplica amb: npx wrangler d1 execute vatio-justo-leads --remote --file schema.sql
CREATE TABLE IF NOT EXISTS leads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  creat        TEXT NOT NULL DEFAULT (datetime('now')),
  correu       TEXT NOT NULL,
  idioma       TEXT,
  tipo         TEXT,
  magnitud     REAL,
  vivienda     TEXT,
  calefaccion  TEXT,
  cuando       TEXT,
  minim        INTEGER,
  maxim        INTEGER,
  estalvi_min  INTEGER,
  estalvi_max  INTEGER,
  estat        TEXT NOT NULL DEFAULT 'nou'
);
CREATE INDEX IF NOT EXISTS idx_leads_creat ON leads (creat);
