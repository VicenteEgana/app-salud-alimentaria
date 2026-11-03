-- Actualiza una base creada con la v1 (schema original) al esquema actual.

ALTER TABLE products ADD COLUMN data_source TEXT NOT NULL DEFAULT 'desconocido';
ALTER TABLE products ADD COLUMN portion_text TEXT;
ALTER TABLE products ADD COLUMN portion_size REAL;
ALTER TABLE products ADD COLUMN dietary_tags TEXT;

-- Precio y disponibilidad por supermercado.
CREATE TABLE IF NOT EXISTS offers (
  ean TEXT NOT NULL,
  store TEXT NOT NULL,                -- jumbo | santa-isabel
  sku TEXT NOT NULL,
  price INTEGER NOT NULL,             -- CLP
  list_price INTEGER,
  ppum_price INTEGER,                 -- precio por unidad de medida (CLP por kg / L)
  ppum_unit TEXT,                     -- kg | lt | un
  url TEXT NOT NULL,
  available INTEGER DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ean, store)
);

-- Reformulaciones: una fila cada vez que cambian los ingredientes o la tabla de un producto verificado
-- (misma fuente, para no confundir diferencias entre fuentes con cambios reales de receta).
CREATE TABLE IF NOT EXISTS product_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ean TEXT NOT NULL,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  old_score INTEGER,
  new_score INTEGER,
  old_ingredients TEXT,
  new_ingredients TEXT,
  old_nutrients_json TEXT,
  new_nutrients_json TEXT,
  old_evaluation_json TEXT,
  new_evaluation_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_ean ON product_history(ean, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_recent ON product_history(changed_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_products_history
AFTER UPDATE ON products
WHEN old.verified = 1 AND new.verified = 1 AND old.data_source = new.data_source
  AND (old.ingredients_raw IS NOT new.ingredients_raw OR old.nutrients_json IS NOT new.nutrients_json)
BEGIN
  INSERT INTO product_history (
    ean, old_score, new_score, old_ingredients, new_ingredients,
    old_nutrients_json, new_nutrients_json, old_evaluation_json, new_evaluation_json
  ) VALUES (
    new.ean, old.final_score, new.final_score, old.ingredients_raw, new.ingredients_raw,
    old.nutrients_json, new.nutrients_json, old.evaluation_json, new.evaluation_json
  );
END;

-- Reportes de usuarios (errores), solicitudes de revisión de marcas y contacto de empresas.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- error | marca | empresa
  ean TEXT,
  name TEXT,
  email TEXT,
  organization TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'nuevo', -- nuevo | revisado
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

-- Contadores de rate limiting por ventana de tiempo.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,      -- epoch en segundos
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- Claves de la API B2B (se guarda solo el hash SHA-256).
CREATE TABLE IF NOT EXISTS api_keys (
  key_hash TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  monthly_quota INTEGER NOT NULL DEFAULT 10000,
  usage_month TEXT,                   -- "2026-11"
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
