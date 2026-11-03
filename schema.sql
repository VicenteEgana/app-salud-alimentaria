-- Esquema completo de D1 (instalación nueva). Una base creada con la v1 se actualiza con
-- migrations/0002_mejoras.sql.

CREATE TABLE IF NOT EXISTS products (
  ean TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  category_slug TEXT NOT NULL,
  is_liquid INTEGER DEFAULT 0,
  image_url TEXT,
  ingredients_raw TEXT NOT NULL,
  nutrients_json TEXT NOT NULL,       -- JSON: { calories, sugars, saturatedFat, sodium, protein, fiber }
  evaluation_json TEXT NOT NULL,      -- JSON completo devuelto por evaluateProduct()
  final_score INTEGER NOT NULL,
  is_fake_healthy INTEGER DEFAULT 0,  -- 1 = 0 sellos MINSAL pero NOVA 4 con aditivos/edulcorantes
  seals_count INTEGER DEFAULT 0,
  verified INTEGER DEFAULT 0,         -- 0 = Escaneado por usuario (pendiente), 1 = Verificado e indexable en SEO
  scan_consensus_count INTEGER DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  data_source TEXT NOT NULL DEFAULT 'desconocido', -- jumbo | santa-isabel | openfoodfacts | ia-usuario | moderacion | seed
  portion_text TEXT,                  -- "1 Vaso (120 g)"
  portion_size REAL,                  -- g o ml de una porción
  dietary_tags TEXT                   -- JSON: condiciones declaradas por la tienda, ej. ["Libre de Gluten"]
);

CREATE INDEX IF NOT EXISTS idx_category_score ON products(category_slug, verified, final_score DESC);
CREATE INDEX IF NOT EXISTS idx_fake_healthy ON products(is_fake_healthy, verified);
CREATE INDEX IF NOT EXISTS idx_products_pending ON products(verified, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_slug ON products(slug);

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
