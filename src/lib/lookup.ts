/**
 * Casos de uso compartidos por la API pública, WhatsApp y la API B2B:
 *   - lookupProduct: cascada D1 → Open Food Facts + Jumbo en vivo → null.
 *   - analyzeLabelAndStore: lectura de etiqueta con IA, guardia anti-alucinación, consenso.
 */
import { fetchCatalogProduct } from './catalog-fetcher';
import {
  buildRow,
  getOffers,
  getProductByEan,
  pendingSlug,
  productToInput,
  uniqueSlug,
  upsertOffer,
  upsertProduct,
  type Offer,
  type Product,
  type ProductInput,
} from './db';
import { LabelExtractionError, extractLabel, validateExtraction } from './label-extractor';
import { consumeRateLimit, toInt } from './rate-limit';
import type { Nutrients } from './scorer';

export interface LookupResult {
  product: Product;
  offers: Offer[];
  source: 'database' | 'catalog';
}

export async function lookupProduct(db: D1Database, ean: string): Promise<LookupResult | null> {
  const existing = await getProductByEan(db, ean);
  if (existing) {
    const offers = (await getOffers(db, [ean])).get(ean) ?? [];
    return { product: existing, offers, source: 'database' };
  }

  const catalog = await fetchCatalogProduct(ean);
  if (!catalog) return null;

  const slug = await uniqueSlug(db, catalog);
  const product = await upsertProduct(db, buildRow(catalog, { slug, verified: true }));
  await Promise.all(catalog.offers.map((o) => upsertOffer(db, o)));
  return { product, offers: catalog.offers.map((o) => ({ ...o, updatedAt: product.updatedAt })), source: 'catalog' };
}

// ---------------------------------------------------------------------------
// Lectura de etiqueta con IA
// ---------------------------------------------------------------------------

const CONSENSUS_TOLERANCE = 0.05;

function withinTolerance(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= CONSENSUS_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

export const readingsAgree = (a: Nutrients, b: Nutrients) =>
  withinTolerance(a.calories, b.calories) && withinTolerance(a.sugars, b.sugars);

export type AnalyzeStatus = 'pending' | 'verified-by-consensus' | 'already-verified';

export type AnalyzeResult =
  | { ok: true; status: AnalyzeStatus; product: Product }
  | { ok: false; httpStatus: number; error: string; code: 'invalid-label' | 'rate-limited' | 'unavailable' | 'error' };

export interface AnalyzeEnv {
  DB: D1Database;
  GEMINI_API_KEY: string;
  ANALYZE_LIMIT_GLOBAL_DAY?: string;
}

/**
 * @param limits buckets de rate limiting del llamador (por IP, por teléfono…). Se consumen solo si
 *               de verdad se va a llamar a la IA (no para productos ya verificados).
 */
export async function analyzeLabelAndStore(
  env: AnalyzeEnv,
  input: { ean: string; hint: string; imageBase64: string; mimeType: string },
  limits: { bucket: string; limit: number; windowSeconds: number }[],
): Promise<AnalyzeResult> {
  if (!env.GEMINI_API_KEY) {
    return { ok: false, httpStatus: 503, error: 'La lectura de etiquetas no está configurada', code: 'unavailable' };
  }
  const db = env.DB;
  const existing = await getProductByEan(db, input.ean);
  // Un producto verificado no se sobreescribe con una lectura de IA.
  if (existing?.verified) return { ok: true, status: 'already-verified', product: existing };

  const allLimits = [
    ...limits,
    { bucket: 'analyze:global', limit: toInt(env.ANALYZE_LIMIT_GLOBAL_DAY, 500), windowSeconds: 86400 },
  ];
  for (const l of allLimits) {
    const r = await consumeRateLimit(db, l.bucket, l.limit, l.windowSeconds);
    if (!r.allowed) {
      return {
        ok: false,
        httpStatus: 429,
        error: 'Alcanzaste el límite de lecturas con IA. Inténtalo más tarde.',
        code: 'rate-limited',
      };
    }
  }

  let extraction;
  try {
    extraction = await extractLabel(env.GEMINI_API_KEY, input.imageBase64, input.mimeType, input.hint);
  } catch (err) {
    if (err instanceof LabelExtractionError) return { ok: false, httpStatus: err.status, error: err.message, code: 'error' };
    console.error('analyzeLabel', err);
    return { ok: false, httpStatus: 502, error: 'No se pudo analizar la etiqueta', code: 'error' };
  }

  const rejection = validateExtraction(extraction);
  if (rejection) return { ok: false, httpStatus: 422, error: rejection, code: 'invalid-label' };

  const reading: ProductInput = {
    ean: input.ean,
    name: extraction.productName.trim() || input.hint || `Producto ${input.ean}`,
    brand: extraction.brand.trim() || 'Sin marca',
    categorySlug: extraction.categorySlug || 'otros',
    isLiquid: extraction.isLiquid,
    imageUrl: null,
    ingredientsRaw: extraction.ingredientsRaw.trim(),
    nutrients: extraction.nutrients,
    dataSource: 'ia-usuario',
    portionSize: extraction.portionSize > 0 ? extraction.portionSize : null,
    portionText: extraction.portionSize > 0 ? `${extraction.portionSize} ${extraction.isLiquid ? 'ml' : 'g'}` : null,
  };

  if (existing && readingsAgree(existing.nutrients, reading.nutrients)) {
    // Dos lecturas independientes coinciden: se aprueba conservando la primera lectura.
    const slug = await uniqueSlug(db, existing);
    const product = await upsertProduct(
      db,
      buildRow(productToInput(existing), { slug, verified: true, scanConsensusCount: existing.scanConsensusCount + 1 }),
    );
    return { ok: true, status: 'verified-by-consensus', product };
  }

  // Primera lectura, o lectura que no coincide con la anterior: queda la más reciente, pendiente de moderación.
  const product = await upsertProduct(db, buildRow(reading, { slug: pendingSlug(input.ean), verified: false }));
  return { ok: true, status: 'pending', product };
}
