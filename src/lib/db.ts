/** Acceso a Cloudflare D1: filas ↔ objetos tipados. */
import { evaluateProduct, type Nutrients, type ProductEvaluation, type RawProductInput } from './scorer';
import { slugify } from './text';

type D1PreparedStatement = ReturnType<D1Database['prepare']>;

/** De dónde salieron los ingredientes y la tabla nutricional. */
export type DataSource = 'jumbo' | 'santa-isabel' | 'openfoodfacts' | 'ia-usuario' | 'moderacion' | 'seed' | 'desconocido';

export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  jumbo: 'Ficha de Jumbo.cl',
  'santa-isabel': 'Ficha de SantaIsabel.cl',
  openfoodfacts: 'Open Food Facts',
  'ia-usuario': 'Foto de la etiqueta enviada por un usuario (leída con IA)',
  moderacion: 'Etiqueta revisada por el equipo de SanoPasillo',
  seed: 'Producto de ejemplo (marca ficticia)',
  desconocido: 'Fuente no registrada',
};

export interface ProductRow {
  ean: string;
  slug: string;
  name: string;
  brand: string;
  category_slug: string;
  is_liquid: number;
  image_url: string | null;
  ingredients_raw: string;
  nutrients_json: string;
  evaluation_json: string;
  final_score: number;
  is_fake_healthy: number;
  seals_count: number;
  verified: number;
  scan_consensus_count: number;
  updated_at: string;
  data_source: string;
  portion_text: string | null;
  portion_size: number | null;
  dietary_tags: string | null;
}

export interface Product {
  ean: string;
  slug: string;
  name: string;
  brand: string;
  categorySlug: string;
  isLiquid: boolean;
  imageUrl: string | null;
  ingredientsRaw: string;
  nutrients: Nutrients;
  evaluation: ProductEvaluation;
  finalScore: number;
  isFakeHealthy: boolean;
  sealsCount: number;
  verified: boolean;
  scanConsensusCount: number;
  updatedAt: string;
  dataSource: DataSource;
  portionText: string | null;
  portionSize: number | null;
  dietaryTags: string[];
}

/** Datos editables de un producto, antes de evaluar. */
export interface ProductInput extends RawProductInput {
  ean: string;
  brand: string;
  imageUrl: string | null;
  dataSource: DataSource;
  portionText?: string | null;
  portionSize?: number | null;
  dietaryTags?: string[];
}

export function rowToProduct(row: ProductRow): Product {
  // Filas antiguas pueden tener evaluaciones sin los campos nuevos: se completan con defaults.
  const evaluation = JSON.parse(row.evaluation_json) as ProductEvaluation;
  evaluation.sweeteners ??= [];
  evaluation.kidsSweetenerWarning ??= false;
  return {
    ean: row.ean,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    categorySlug: row.category_slug,
    isLiquid: row.is_liquid === 1,
    imageUrl: row.image_url,
    ingredientsRaw: row.ingredients_raw,
    nutrients: JSON.parse(row.nutrients_json) as Nutrients,
    evaluation,
    finalScore: row.final_score,
    isFakeHealthy: row.is_fake_healthy === 1,
    sealsCount: row.seals_count,
    verified: row.verified === 1,
    scanConsensusCount: row.scan_consensus_count,
    updatedAt: row.updated_at,
    dataSource: (row.data_source ?? 'desconocido') as DataSource,
    portionText: row.portion_text ?? null,
    portionSize: row.portion_size ?? null,
    dietaryTags: row.dietary_tags ? (JSON.parse(row.dietary_tags) as string[]) : [],
  };
}

/** Un Product ya guardado, como entrada editable (para re-evaluar o moderar). */
export function productToInput(p: Product): ProductInput {
  return {
    ean: p.ean,
    name: p.name,
    brand: p.brand,
    categorySlug: p.categorySlug,
    isLiquid: p.isLiquid,
    imageUrl: p.imageUrl,
    ingredientsRaw: p.ingredientsRaw,
    nutrients: p.nutrients,
    dataSource: p.dataSource,
    portionText: p.portionText,
    portionSize: p.portionSize,
    dietaryTags: p.dietaryTags,
  };
}

export type NewProductRow = Omit<ProductRow, 'updated_at'>;

/** Evalúa y arma la fila completa. `slug` y `verified` los decide quien llama. */
export function buildRow(
  input: ProductInput,
  opts: { slug: string; verified: boolean; scanConsensusCount?: number },
): NewProductRow {
  const evaluation = evaluateProduct(input);
  return {
    ean: input.ean,
    slug: opts.slug,
    name: input.name,
    brand: input.brand,
    category_slug: input.categorySlug,
    is_liquid: input.isLiquid ? 1 : 0,
    image_url: input.imageUrl,
    ingredients_raw: input.ingredientsRaw,
    nutrients_json: JSON.stringify(input.nutrients),
    evaluation_json: JSON.stringify(evaluation),
    final_score: evaluation.finalScore,
    is_fake_healthy: evaluation.isFakeHealthy ? 1 : 0,
    seals_count: evaluation.minsalSeals.length,
    verified: opts.verified ? 1 : 0,
    scan_consensus_count: opts.scanConsensusCount ?? 1,
    data_source: input.dataSource,
    portion_text: input.portionText ?? null,
    portion_size: input.portionSize ?? null,
    dietary_tags: input.dietaryTags?.length ? JSON.stringify(input.dietaryTags) : null,
  };
}

const COLUMNS = [
  'ean',
  'slug',
  'name',
  'brand',
  'category_slug',
  'is_liquid',
  'image_url',
  'ingredients_raw',
  'nutrients_json',
  'evaluation_json',
  'final_score',
  'is_fake_healthy',
  'seals_count',
  'verified',
  'scan_consensus_count',
  'data_source',
  'portion_text',
  'portion_size',
  'dietary_tags',
] as const satisfies readonly (keyof NewProductRow)[];

/** INSERT … ON CONFLICT(ean) DO UPDATE. Usado también por el seed y la ingesta (vía SQL generado). */
export function upsertSql(): string {
  const updates = COLUMNS.filter((c) => c !== 'ean')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  return `INSERT INTO products (${COLUMNS.join(', ')}, updated_at)
VALUES (${COLUMNS.map(() => '?').join(', ')}, CURRENT_TIMESTAMP)
ON CONFLICT(ean) DO UPDATE SET ${updates}, updated_at = CURRENT_TIMESTAMP`;
}

export function rowValues(row: NewProductRow): (string | number | null)[] {
  return COLUMNS.map((c) => row[c]);
}

export async function upsertProduct(db: D1Database, row: NewProductRow): Promise<Product> {
  await db.prepare(upsertSql()).bind(...rowValues(row)).run();
  const saved = await getProductByEan(db, row.ean);
  if (!saved) throw new Error(`No se pudo guardar el producto ${row.ean}`);
  return saved;
}

/** Slug pendiente para escaneos sin verificar (no se indexa). */
export const pendingSlug = (ean: string) => `pendiente-${ean}`;

/** Slug "marca-nombre" sin consultar la base (seed e ingesta). */
export function baseSlug(input: Pick<ProductInput, 'ean' | 'name' | 'brand'>): string {
  const brand = slugify(input.brand.replace(/\(demo\)/i, ''));
  const name = slugify(input.name);
  // Los nombres de supermercado suelen incluir la marca ("Yogurt Colun Origen 120 g"): no repetirla.
  const slug = name.includes(brand) || brand === 'sin-marca' ? name : `${brand}-${name}`;
  return slug || `producto-${input.ean}`;
}

/** Slug definitivo; si ya lo usa otro EAN, agrega los últimos dígitos del EAN. */
export async function uniqueSlug(db: D1Database, input: Pick<ProductInput, 'ean' | 'name' | 'brand'>): Promise<string> {
  const candidate = baseSlug(input);
  const owner = await db.prepare('SELECT ean FROM products WHERE slug = ?').bind(candidate).first<{ ean: string }>();
  if (!owner || owner.ean === input.ean) return candidate;
  return `${candidate}-${input.ean.slice(-5)}`;
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

async function all(stmt: D1PreparedStatement): Promise<Product[]> {
  const { results } = await stmt.all<ProductRow>();
  return results.map(rowToProduct);
}

export async function getProductByEan(db: D1Database, ean: string): Promise<Product | null> {
  const row = await db.prepare('SELECT * FROM products WHERE ean = ?').bind(ean).first<ProductRow>();
  return row ? rowToProduct(row) : null;
}

export async function getProductBySlug(db: D1Database, slug: string): Promise<Product | null> {
  const row = await db.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).first<ProductRow>();
  return row ? rowToProduct(row) : null;
}

export function getCategoryProducts(db: D1Database, categorySlug: string): Promise<Product[]> {
  return all(
    db
      .prepare('SELECT * FROM products WHERE category_slug = ? AND verified = 1 ORDER BY final_score DESC, name')
      .bind(categorySlug),
  );
}

/** Alternativas verificadas de la misma categoría con mejor puntaje. */
export function getHealthierAlternatives(db: D1Database, product: Product, limit = 4): Promise<Product[]> {
  return all(
    db
      .prepare(
        `SELECT * FROM products
         WHERE category_slug = ? AND verified = 1 AND ean != ? AND final_score > ?
         ORDER BY final_score DESC LIMIT ?`,
      )
      .bind(product.categorySlug, product.ean, product.finalScore, limit),
  );
}

export function getPendingProducts(db: D1Database, limit = 100): Promise<Product[]> {
  return all(db.prepare('SELECT * FROM products WHERE verified = 0 ORDER BY updated_at DESC LIMIT ?').bind(limit));
}

export function getFakeHealthy(db: D1Database, limit = 6): Promise<Product[]> {
  return all(
    db
      .prepare('SELECT * FROM products WHERE is_fake_healthy = 1 AND verified = 1 ORDER BY final_score ASC LIMIT ?')
      .bind(limit),
  );
}

export function searchProducts(db: D1Database, query: string, limit = 12): Promise<Product[]> {
  const like = `%${query.replace(/[%_]/g, '')}%`;
  return all(
    db
      .prepare(
        `SELECT * FROM products
         WHERE verified = 1 AND (name LIKE ?1 OR brand LIKE ?1 OR ean = ?2)
         ORDER BY final_score DESC LIMIT ?3`,
      )
      .bind(like, query, limit),
  );
}

export interface CategorySummary {
  categorySlug: string;
  total: number;
  fakeHealthy: number;
  bestScore: number;
}

export async function getCategorySummaries(db: D1Database): Promise<CategorySummary[]> {
  const { results } = await db
    .prepare(
      `SELECT category_slug AS categorySlug, COUNT(*) AS total,
              SUM(is_fake_healthy) AS fakeHealthy, MAX(final_score) AS bestScore
       FROM products WHERE verified = 1
       GROUP BY category_slug ORDER BY total DESC`,
    )
    .all<CategorySummary>();
  return results;
}

/** Los N mejores verificados de cada categoría (para cruces versus del sitemap y la home). */
export async function getTopSlugsByCategory(db: D1Database, perCategory = 8): Promise<Map<string, string[]>> {
  const { results } = await db
    .prepare(
      `SELECT slug, category_slug FROM (
         SELECT slug, category_slug,
                ROW_NUMBER() OVER (PARTITION BY category_slug ORDER BY final_score DESC, slug) AS rn
         FROM products WHERE verified = 1
       ) WHERE rn <= ?`,
    )
    .bind(perCategory)
    .all<{ slug: string; category_slug: string }>();
  const map = new Map<string, string[]>();
  for (const r of results) map.set(r.category_slug, [...(map.get(r.category_slug) ?? []), r.slug]);
  return map;
}

export async function getVerifiedSlugs(db: D1Database): Promise<{ slug: string; updated_at: string }[]> {
  const { results } = await db
    .prepare('SELECT slug, updated_at FROM products WHERE verified = 1 ORDER BY updated_at DESC LIMIT 45000')
    .all<{ slug: string; updated_at: string }>();
  return results;
}

// ---------------------------------------------------------------------------
// Ofertas (precio por supermercado)
// ---------------------------------------------------------------------------

export type StoreId = 'jumbo' | 'santa-isabel';

export interface Offer {
  ean: string;
  store: StoreId;
  sku: string;
  price: number;
  listPrice: number | null;
  ppumPrice: number | null;
  ppumUnit: string | null;
  url: string;
  available: boolean;
  updatedAt: string;
}

interface OfferRow {
  ean: string;
  store: string;
  sku: string;
  price: number;
  list_price: number | null;
  ppum_price: number | null;
  ppum_unit: string | null;
  url: string;
  available: number;
  updated_at: string;
}

const rowToOffer = (r: OfferRow): Offer => ({
  ean: r.ean,
  store: r.store as StoreId,
  sku: r.sku,
  price: r.price,
  listPrice: r.list_price,
  ppumPrice: r.ppum_price,
  ppumUnit: r.ppum_unit,
  url: r.url,
  available: r.available === 1,
  updatedAt: r.updated_at,
});

export const OFFER_UPSERT_SQL = `INSERT INTO offers (ean, store, sku, price, list_price, ppum_price, ppum_unit, url, available, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(ean, store) DO UPDATE SET sku = excluded.sku, price = excluded.price, list_price = excluded.list_price,
  ppum_price = excluded.ppum_price, ppum_unit = excluded.ppum_unit, url = excluded.url,
  available = excluded.available, updated_at = CURRENT_TIMESTAMP`;

export function offerValues(o: Omit<Offer, 'updatedAt'>): (string | number | null)[] {
  return [o.ean, o.store, o.sku, o.price, o.listPrice, o.ppumPrice, o.ppumUnit, o.url, o.available ? 1 : 0];
}

export async function upsertOffer(db: D1Database, offer: Omit<Offer, 'updatedAt'>): Promise<void> {
  await db.prepare(OFFER_UPSERT_SQL).bind(...offerValues(offer)).run();
}

export async function getOffers(db: D1Database, eans: string[]): Promise<Map<string, Offer[]>> {
  const map = new Map<string, Offer[]>();
  if (eans.length === 0) return map;
  const unique = [...new Set(eans)].slice(0, 100);
  const { results } = await db
    .prepare(`SELECT * FROM offers WHERE ean IN (${unique.map(() => '?').join(',')}) ORDER BY price ASC`)
    .bind(...unique)
    .all<OfferRow>();
  for (const r of results) map.set(r.ean, [...(map.get(r.ean) ?? []), rowToOffer(r)]);
  return map;
}

/** Las opciones con puntaje ≥ minScore más baratas por kilo/litro de una categoría. */
export async function getBestValue(
  db: D1Database,
  categorySlug: string,
  minScore: number,
  limit = 3,
): Promise<{ product: Product; offer: Offer }[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, o.store AS o_store, o.sku AS o_sku, o.price AS o_price, o.list_price AS o_list_price,
              o.ppum_price AS o_ppum_price, o.ppum_unit AS o_ppum_unit, o.url AS o_url,
              o.available AS o_available, o.updated_at AS o_updated_at
       FROM products p JOIN offers o ON o.ean = p.ean
       WHERE p.category_slug = ? AND p.verified = 1 AND p.final_score >= ? AND o.available = 1 AND o.ppum_price > 0
       ORDER BY o.ppum_price ASC LIMIT ?`,
    )
    .bind(categorySlug, minScore, limit)
    .all<ProductRow & Record<`o_${string}`, string | number | null>>();
  return results.map((r) => ({
    product: rowToProduct(r),
    offer: rowToOffer({
      ean: r.ean,
      store: String(r.o_store),
      sku: String(r.o_sku),
      price: Number(r.o_price),
      list_price: r.o_list_price === null ? null : Number(r.o_list_price),
      ppum_price: r.o_ppum_price === null ? null : Number(r.o_ppum_price),
      ppum_unit: r.o_ppum_unit === null ? null : String(r.o_ppum_unit),
      url: String(r.o_url),
      available: Number(r.o_available),
      updated_at: String(r.o_updated_at),
    }),
  }));
}

// ---------------------------------------------------------------------------
// Historial de reformulaciones (lo llena el trigger trg_products_history)
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: number;
  ean: string;
  changedAt: string;
  oldScore: number | null;
  newScore: number | null;
  oldIngredients: string | null;
  newIngredients: string | null;
  oldNutrients: Nutrients | null;
  newNutrients: Nutrients | null;
  oldEvaluation: ProductEvaluation | null;
  newEvaluation: ProductEvaluation | null;
}

interface HistoryRow {
  id: number;
  ean: string;
  changed_at: string;
  old_score: number | null;
  new_score: number | null;
  old_ingredients: string | null;
  new_ingredients: string | null;
  old_nutrients_json: string | null;
  new_nutrients_json: string | null;
  old_evaluation_json: string | null;
  new_evaluation_json: string | null;
}

const parse = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

const rowToHistory = (r: HistoryRow): HistoryEntry => ({
  id: r.id,
  ean: r.ean,
  changedAt: r.changed_at,
  oldScore: r.old_score,
  newScore: r.new_score,
  oldIngredients: r.old_ingredients,
  newIngredients: r.new_ingredients,
  oldNutrients: parse<Nutrients>(r.old_nutrients_json),
  newNutrients: parse<Nutrients>(r.new_nutrients_json),
  oldEvaluation: parse<ProductEvaluation>(r.old_evaluation_json),
  newEvaluation: parse<ProductEvaluation>(r.new_evaluation_json),
});

export async function getProductHistory(db: D1Database, ean: string, limit = 10): Promise<HistoryEntry[]> {
  const { results } = await db
    .prepare('SELECT * FROM product_history WHERE ean = ? ORDER BY changed_at DESC, id DESC LIMIT ?')
    .bind(ean, limit)
    .all<HistoryRow>();
  return results.map(rowToHistory);
}

/** Cambios recientes de cualquier producto verificado, o solo de los EAN indicados. */
export async function getRecentHistory(
  db: D1Database,
  opts: { eans?: string[]; since?: string; limit?: number } = {},
): Promise<{ entry: HistoryEntry; product: Product }[]> {
  const where: string[] = ['p.verified = 1'];
  const binds: (string | number)[] = [];
  if (opts.eans?.length) {
    const eans = [...new Set(opts.eans)].slice(0, 100);
    where.push(`h.ean IN (${eans.map(() => '?').join(',')})`);
    binds.push(...eans);
  }
  if (opts.since) {
    where.push('h.changed_at > ?');
    binds.push(opts.since);
  }
  binds.push(opts.limit ?? 30);
  const { results } = await db
    .prepare(
      `SELECT h.id AS h_id, h.changed_at AS h_changed_at, h.old_score AS h_old_score, h.new_score AS h_new_score,
              h.old_ingredients AS h_old_ingredients, h.new_ingredients AS h_new_ingredients,
              h.old_nutrients_json AS h_old_nutrients_json, h.new_nutrients_json AS h_new_nutrients_json,
              h.old_evaluation_json AS h_old_evaluation_json, h.new_evaluation_json AS h_new_evaluation_json, p.*
       FROM product_history h JOIN products p ON p.ean = h.ean
       WHERE ${where.join(' AND ')}
       ORDER BY h.changed_at DESC, h.id DESC LIMIT ?`,
    )
    .bind(...binds)
    .all<ProductRow & Record<`h_${string}`, string | number | null>>();
  return results.map((r) => ({
    product: rowToProduct(r),
    entry: rowToHistory({
      id: Number(r.h_id),
      ean: r.ean,
      changed_at: String(r.h_changed_at),
      old_score: r.h_old_score === null ? null : Number(r.h_old_score),
      new_score: r.h_new_score === null ? null : Number(r.h_new_score),
      old_ingredients: r.h_old_ingredients as string | null,
      new_ingredients: r.h_new_ingredients as string | null,
      old_nutrients_json: r.h_old_nutrients_json as string | null,
      new_nutrients_json: r.h_new_nutrients_json as string | null,
      old_evaluation_json: r.h_old_evaluation_json as string | null,
      new_evaluation_json: r.h_new_evaluation_json as string | null,
    }),
  }));
}

// ---------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------

export type ReportKind = 'error' | 'marca' | 'empresa';

export interface Report {
  id: number;
  kind: ReportKind;
  ean: string | null;
  name: string | null;
  email: string | null;
  organization: string | null;
  message: string;
  status: 'nuevo' | 'revisado';
  createdAt: string;
}

export async function insertReport(
  db: D1Database,
  r: Omit<Report, 'id' | 'status' | 'createdAt'>,
): Promise<void> {
  await db
    .prepare('INSERT INTO reports (kind, ean, name, email, organization, message) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(r.kind, r.ean, r.name, r.email, r.organization, r.message)
    .run();
}

export async function getReports(db: D1Database, status: 'nuevo' | 'revisado' = 'nuevo', limit = 100): Promise<Report[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, ean, name, email, organization, message, status, created_at AS createdAt
       FROM reports WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(status, limit)
    .all<Report>();
  return results;
}
