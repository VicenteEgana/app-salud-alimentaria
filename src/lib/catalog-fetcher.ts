/**
 * Catálogos chilenos en vivo:
 *   1. Open Food Facts Chile — busca por EAN; da el nombre (y a veces la tabla).
 *   2. Jumbo / Santa Isabel — su búsqueda no acepta EAN, así que se busca por el nombre que dio OFF
 *      y se confirma el EAN en la ficha. La ficha chilena tiene prioridad: es la etiqueta local, con precio.
 *
 * La ingesta masiva (scripts/ingest-chile.ts) recorre Jumbo por términos de búsqueda y usa
 * `storeProductToCatalog` directamente, sin pasar por OFF.
 */
import { guessCategorySlug } from './categories';
import type { DataSource, Offer, ProductInput } from './db';
import type { Nutrients } from './scorer';
import { fetchProductPage, searchCatalog, type StoreProduct } from './stores/cencosud';
import { normalizeText } from './text';

export interface CatalogProduct extends ProductInput {
  offers: Omit<Offer, 'updatedAt'>[];
  sources: string[];
}

const USER_AGENT = 'SanoPasillo/0.2 (+https://sanopasillo.cl/metodologia)';
const REQUIRED_NUTRIENTS = ['calories', 'sugars', 'saturatedFat', 'sodium'] as const;

/** Lo que una fuente logró extraer; puede venir incompleto. */
interface PartialProduct {
  source: DataSource;
  name?: string;
  brand?: string;
  categoryTexts: string[];
  fallbackCategory?: string;
  isLiquid?: boolean;
  imageUrl?: string;
  ingredientsRaw?: string;
  nutrients: Partial<Nutrients>;
  portionText?: string;
  portionSize?: number;
  dietaryTags?: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function parseLocaleNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const match = value.replace(/\s/g, '').match(/-?[\d.,]+/);
  if (!match) return undefined;
  let n = match[0];
  if (n.includes(',') && n.includes('.')) n = n.replace(/\./g, '').replace(',', '.');
  else n = n.replace(',', '.');
  const parsed = Number.parseFloat(n);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ---------------------------------------------------------------------------
// Open Food Facts
// ---------------------------------------------------------------------------

export function parseOffProduct(raw: unknown): PartialProduct | null {
  if (!isRecord(raw) || raw.status !== 1 || !isRecord(raw.product)) return null;
  const p = raw.product;
  const n = isRecord(p.nutriments) ? p.nutriments : {};
  const num = (key: string) => parseLocaleNumber(n[key]);

  // OFF guarda el sodio en gramos.
  const sodiumG = num('sodium_100g') ?? (num('salt_100g') !== undefined ? num('salt_100g')! / 2.5 : undefined);
  const kcal = num('energy-kcal_100g') ?? (num('energy_100g') !== undefined ? num('energy_100g')! / 4.184 : undefined);

  const quantity = normalizeText(`${str(p.quantity) ?? ''} ${str(p.product_quantity_unit) ?? ''}`);
  const categoryTags = Array.isArray(p.categories_tags)
    ? p.categories_tags.filter((c): c is string => typeof c === 'string')
    : [];
  const categoryNames = (str(p.categories) ?? '')
    .split(',')
    .map((c) => c.replace(/^\w\w:/, '').trim())
    .filter(Boolean);

  return {
    source: 'openfoodfacts',
    name: str(p.product_name_es) ?? str(p.product_name),
    brand: str(p.brands)?.split(',')[0]?.trim(),
    categoryTexts: [...categoryNames, ...categoryTags.map((t) => t.replace(/^\w\w:/, '').replace(/-/g, ' '))],
    fallbackCategory: categoryNames.at(-1),
    isLiquid:
      /\b(ml|cl|l|lt|litros?)\b/.test(quantity) ||
      categoryTags.some((t) => /beverages|bebidas|milks|leches|drinks/.test(t)),
    imageUrl: str(p.image_front_url) ?? str(p.image_url),
    ingredientsRaw: str(p.ingredients_text_es) ?? str(p.ingredients_text),
    nutrients: {
      calories: kcal !== undefined ? Math.round(kcal) : undefined,
      sugars: num('sugars_100g'),
      saturatedFat: num('saturated-fat_100g'),
      sodium: sodiumG !== undefined ? Math.round(sodiumG * 1000) : undefined,
      protein: num('proteins_100g'),
      fiber: num('fiber_100g'),
    },
    portionText: str(p.serving_size),
  };
}

async function fetchFromOpenFoodFacts(ean: string): Promise<PartialProduct | null> {
  const fields = [
    'product_name',
    'product_name_es',
    'brands',
    'categories',
    'categories_tags',
    'quantity',
    'product_quantity_unit',
    'serving_size',
    'image_front_url',
    'image_url',
    'ingredients_text',
    'ingredients_text_es',
    'nutriments',
  ].join(',');
  try {
    const res = await fetch(`https://cl.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=${fields}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    return res.ok ? parseOffProduct(await res.json()) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Jumbo / Santa Isabel
// ---------------------------------------------------------------------------

function storeToPartial(sp: StoreProduct): PartialProduct {
  return {
    source: sp.store,
    name: sp.name,
    brand: sp.brand,
    categoryTexts: sp.categoryNames,
    fallbackCategory: sp.categoryNames.at(-1),
    isLiquid: sp.isLiquid,
    imageUrl: sp.imageUrl ?? undefined,
    ingredientsRaw: sp.ingredientsRaw ?? undefined,
    nutrients: sp.nutrients,
    portionText: sp.portionText ?? undefined,
    portionSize: sp.portionSize ?? undefined,
    dietaryTags: sp.dietaryTags,
  };
}

export function storeOffer(sp: StoreProduct): Omit<Offer, 'updatedAt'> | null {
  if (!sp.sku || sp.price === null) return null;
  return {
    ean: sp.ean,
    store: sp.store,
    sku: sp.sku,
    price: sp.price,
    listPrice: sp.listPrice,
    ppumPrice: sp.ppumPrice,
    ppumUnit: sp.ppumUnit,
    url: sp.url,
    available: sp.available,
  };
}

/** Palabras en común entre dos nombres (0–1), para elegir el candidato correcto de la búsqueda. */
function nameSimilarity(a: string, b: string): number {
  const words = (s: string) => new Set(normalizeText(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size);
}

/** Busca en Jumbo por nombre y devuelve la ficha cuyo EAN coincide (revisa como máximo 2 fichas). */
async function findInJumbo(ean: string, name: string, brand?: string): Promise<StoreProduct | null> {
  const query = [brand, name].filter(Boolean).join(' ').slice(0, 80);
  const hits = await searchCatalog('jumbo', query, { to: 8, timeoutMs: 5000 });
  const ranked = hits
    .map((h) => ({ h, score: nameSimilarity(`${h.brand} ${h.name}`, query) }))
    .filter((x) => x.score >= 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  for (const { h } of ranked) {
    const page = await fetchProductPage('jumbo', h.slug, { ean, timeoutMs: 6000 });
    if (page?.ean === ean) return page;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Combinación
// ---------------------------------------------------------------------------

function mergeSources(
  ean: string,
  parts: PartialProduct[],
  offers: Omit<Offer, 'updatedAt'>[],
): CatalogProduct | null {
  if (parts.length === 0) return null;
  const pick = <K extends keyof PartialProduct>(key: K) =>
    parts.map((p) => p[key]).find((v) => v !== undefined && v !== '') as PartialProduct[K] | undefined;

  // La tabla debe venir completa de una sola fuente: mezclar el sodio de una etiqueta con
  // el azúcar de otra daría una evaluación que no corresponde a ningún envase real.
  const nutritionSource = parts.find((p) => REQUIRED_NUTRIENTS.every((k) => p.nutrients[k] !== undefined));
  const ingredientsRaw = nutritionSource?.ingredientsRaw ?? pick('ingredientsRaw');
  const name = pick('name');
  if (!name || !ingredientsRaw || !nutritionSource) return null;
  const n = nutritionSource.nutrients;

  return {
    ean,
    name,
    brand: pick('brand') ?? 'Sin marca',
    categorySlug: guessCategorySlug(name, parts[0]?.categoryTexts ?? [], pick('fallbackCategory')),
    isLiquid: nutritionSource.isLiquid ?? pick('isLiquid') ?? false,
    imageUrl: pick('imageUrl') ?? null,
    ingredientsRaw,
    nutrients: {
      calories: n.calories!,
      sugars: n.sugars!,
      saturatedFat: n.saturatedFat!,
      sodium: n.sodium!,
      protein: n.protein ?? 0,
      fiber: n.fiber ?? 0,
    },
    dataSource: nutritionSource.source,
    portionText: nutritionSource.portionText ?? pick('portionText') ?? null,
    portionSize: nutritionSource.portionSize ?? pick('portionSize') ?? null,
    dietaryTags: pick('dietaryTags') ?? [],
    offers,
    sources: parts.map((p) => p.source),
  };
}

/** Una ficha de supermercado ya descargada → producto evaluable (o null si le faltan datos). */
export function storeProductToCatalog(sp: StoreProduct): CatalogProduct | null {
  const offer = storeOffer(sp);
  return mergeSources(sp.ean, [storeToPartial(sp)], offer ? [offer] : []);
}

/** Busca un EAN en Open Food Facts y Jumbo. Devuelve null si no hay datos evaluables. */
export async function fetchCatalogProduct(ean: string): Promise<CatalogProduct | null> {
  const off = await fetchFromOpenFoodFacts(ean);
  const jumbo = off?.name ? await findInJumbo(ean, off.name, off.brand) : null;
  const parts = [jumbo ? storeToPartial(jumbo) : null, off].filter((p): p is PartialProduct => p !== null);
  const offer = jumbo ? storeOffer(jumbo) : null;
  return mergeSources(ean, parts, offer ? [offer] : []);
}
