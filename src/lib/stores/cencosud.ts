/**
 * Jumbo y Santa Isabel (Cencosud) sobre su frontend actual (Next.js):
 *   - Búsqueda: POST {origin}/api/catalog — API pública documentada en {origin}/openapi.json
 *     (precio, stock, slug). No acepta búsqueda por EAN.
 *   - Ficha: GET {origin}/{slug}/p — el payload incluye `items[].ean`, `specifications`
 *     (ingredientes, porción, condiciones alimentarias) y la tabla nutricional "100 g / porción".
 *   - Carro: {origin}/?sku=a,b&qty=1,2 (formato que devuelve GET /api/cart/url).
 *
 * El endpoint VTEX antiguo (/api/catalog_system/pub/products/search) ya no responde.
 */
import type { StoreId } from '../db';
import type { Nutrients } from '../scorer';
import { normalizeText } from '../text';

export interface StoreConfig {
  id: StoreId;
  name: string;
  origin: string;
}

export const CENCOSUD_STORES: StoreConfig[] = [
  { id: 'jumbo', name: 'Jumbo', origin: 'https://www.jumbo.cl' },
  { id: 'santa-isabel', name: 'Santa Isabel', origin: 'https://www.santaisabel.cl' },
];

export const storeConfig = (id: StoreId) => CENCOSUD_STORES.find((s) => s.id === id)!;

const USER_AGENT = 'SanoPasillo/0.2 (+https://sanopasillo.cl/metodologia)';

export interface CatalogHit {
  store: StoreId;
  slug: string;
  name: string;
  brand: string;
  sku: string;
  price: number;
  listPrice: number | null;
  ppumPrice: number | null;
  ppumUnit: string | null;
  imageUrl: string | null;
  available: boolean;
  categoryNames: string[];
}

export interface StoreProduct {
  store: StoreId;
  ean: string;
  sku: string;
  slug: string;
  url: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  categoryNames: string[];
  ingredientsRaw: string | null;
  /** Solo los nutrientes que la ficha declara por 100 g/ml. */
  nutrients: Partial<Nutrients>;
  portionText: string | null;
  portionSize: number | null;
  netContent: string | null;
  isLiquid: boolean;
  dietaryTags: string[];
  price: number | null;
  listPrice: number | null;
  ppumPrice: number | null;
  ppumUnit: string | null;
  available: boolean;
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseCatalogResponse(store: StoreId, data: unknown): CatalogHit[] {
  if (!isRecord(data) || !Array.isArray(data.products)) return [];
  return data.products.filter(isRecord).flatMap((p): CatalogHit[] => {
    const item = Array.isArray(p.items) ? p.items.find(isRecord) : undefined;
    const slug = str(p.slug);
    const sku = str(item?.skuId);
    const price = num(item?.price);
    if (!slug || !sku || price === null || !item) return [];
    const images = Array.isArray(item.images) ? item.images : [];
    return [
      {
        store,
        slug,
        name: str(item.name) ?? str(p.productName) ?? slug,
        brand: str(p.brand) ?? 'Sin marca',
        sku,
        price,
        listPrice: num(item.listPrice),
        ppumPrice: num(item.ppumPrice),
        ppumUnit: str(item.ppumMeasurementUnit),
        imageUrl: typeof images[0] === 'string' ? images[0] : null,
        available: item.stock !== false,
        categoryNames: Array.isArray(p.categoryNames) ? p.categoryNames.filter((c): c is string => typeof c === 'string') : [],
      },
    ];
  });
}

export async function searchCatalog(
  store: StoreId,
  query: string,
  opts: { from?: number; to?: number; timeoutMs?: number } = {},
): Promise<CatalogHit[]> {
  const { origin } = storeConfig(store);
  try {
    const res = await fetch(`${origin}/api/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ fullText: query, from: opts.from ?? 0, to: opts.to ?? 10 }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
    });
    if (!res.ok) return [];
    return parseCatalogResponse(store, await res.json());
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ficha de producto
// ---------------------------------------------------------------------------

/** Junta los fragmentos `self.__next_f.push([1,"…"])` del payload RSC en un solo texto. */
export function extractRscPayload(html: string): string {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let out = '';
  for (const m of html.matchAll(re)) {
    try {
      out += JSON.parse(`"${m[1]}"`) as string;
    } catch {
      // Fragmento truncado: se ignora.
    }
  }
  return out;
}

/** Lista de especificaciones `{"key":"…","value":["…"]}` del payload. La primera aparición gana. */
export function parseSpecifications(payload: string): Map<string, string[]> {
  const specs = new Map<string, string[]>();
  const re = /\{"key":"((?:[^"\\]|\\.)*)","value":(\[(?:"(?:[^"\\]|\\.)*",?)*\])\}/g;
  for (const m of payload.matchAll(re)) {
    try {
      const key = JSON.parse(`"${m[1]}"`) as string;
      if (!specs.has(key)) specs.set(key, JSON.parse(m[2]!) as string[]);
    } catch {
      // Ignorar entradas mal formadas.
    }
  }
  return specs;
}

/** "3,58" → 3.58 ; "1.234,5" → 1234.5 ; "<0,5" → 0.5 ; "Tr" / "-" → 0 */
export function parseClNumber(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const v = value.trim();
  if (/^(tr|trazas|-|–|n\/?d)$/i.test(v)) return 0;
  const match = v.replace(/\s/g, '').match(/-?[\d.,]+/);
  if (!match) return null;
  let n = match[0];
  if (n.includes(',') && n.includes('.')) n = n.replace(/\./g, '').replace(',', '.');
  else n = n.replace(',', '.');
  const parsed = Number.parseFloat(n);
  return Number.isFinite(parsed) ? parsed : null;
}

const NUTRIENT_KEYS: { key: keyof Nutrients; re: RegExp }[] = [
  { key: 'calories', re: /^energia/ },
  { key: 'sugars', re: /^azucares/ },
  { key: 'saturatedFat', re: /^grasas?\s+saturadas?/ },
  { key: 'sodium', re: /^sodio/ },
  { key: 'protein', re: /^proteinas?/ },
  { key: 'fiber', re: /^fibra/ },
];

/**
 * Tabla nutricional. El formato estructurado trae `gramsMilliliters` (por 100 g/ml) y `onePortion`;
 * el de especificaciones trae "100g / porción" en un solo string ("3,58 / 4,30").
 */
export function parseNutritionTable(payload: string, specs: Map<string, string[]>): Partial<Nutrients> {
  const nutrients: Partial<Nutrients> = {};
  const assign = (rawKey: string, per100: number | null) => {
    if (per100 === null) return;
    const k = normalizeText(rawKey);
    const match = NUTRIENT_KEYS.find((n) => n.re.test(k));
    if (!match || nutrients[match.key] !== undefined) return;
    // "Energía (kJ)" no sirve; el sodio en gramos se pasa a mg.
    if (match.key === 'calories' && /kj/.test(k) && !/kcal/.test(k)) return;
    nutrients[match.key] = match.key === 'sodium' && /\(g\)/.test(k) ? per100 * 1000 : per100;
  };

  const structured = /\{"key":"((?:[^"\\]|\\.)*)","gramsMilliliters":"((?:[^"\\]|\\.)*)"/g;
  for (const m of payload.matchAll(structured)) assign(m[1]!, parseClNumber(m[2]));

  for (const [key, values] of specs) {
    const first = values[0];
    if (first && first.includes('/')) assign(key, parseClNumber(first.split('/')[0]));
  }
  return nutrients;
}

/** "1 Vaso (120 g)" → 120 ; "2 rebanadas (50g)" → 50 ; "200 ml" → 200 */
export function parsePortionSize(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(g|gr|grs|ml|cc)\b/i);
  return m ? parseClNumber(m[1]) : null;
}

interface ItemInfo {
  sku: string;
  ean: string;
  name: string | null;
  price: number | null;
  listPrice: number | null;
  ppumPrice: number | null;
  ppumUnit: string | null;
  stock: boolean;
}

/** Ítems `{"skuId":"…","ean":"…",…}` del payload (un producto puede tener varios SKU). */
export function parseItems(payload: string): ItemInfo[] {
  const items: ItemInfo[] = [];
  const re = /\{"skuId":"(\d+)","ean":"(\d{8,14})"([^{}]*)/g;
  for (const m of payload.matchAll(re)) {
    const rest = m[3] ?? '';
    const field = (name: string) => rest.match(new RegExp(`"${name}":("(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?|true|false|null)`))?.[1];
    const asNum = (name: string) => {
      const v = field(name);
      return v && /^-?\d/.test(v) ? Number(v) : null;
    };
    const asStr = (name: string) => {
      const v = field(name);
      return v?.startsWith('"') ? (JSON.parse(v) as string) : null;
    };
    items.push({
      sku: m[1]!,
      ean: m[2]!,
      name: asStr('name'),
      price: asNum('price'),
      listPrice: asNum('listPrice'),
      ppumPrice: asNum('ppumPrice'),
      ppumUnit: asStr('ppumMeasurementUnit'),
      stock: field('stock') !== 'false',
    });
  }
  return items;
}

interface JsonLdProduct {
  name?: string;
  gtin?: string;
  gtin13?: string;
  image?: string | string[];
  brand?: { name?: string } | string;
  offers?: { price?: number; availability?: string; url?: string };
}

function parseJsonLd(html: string): { product: JsonLdProduct | null; breadcrumbs: string[] } {
  let product: JsonLdProduct | null = null;
  let breadcrumbs: string[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      for (const node of ([] as unknown[]).concat(JSON.parse(m[1]!))) {
        if (!isRecord(node)) continue;
        if (node['@type'] === 'Product') product = node as JsonLdProduct;
        if (node['@type'] === 'BreadcrumbList' && Array.isArray(node.itemListElement)) {
          breadcrumbs = node.itemListElement
            .map((li) => (isRecord(li) ? str(li.name) : null))
            .filter((n): n is string => n !== null && !/^(inicio|home|jumbo|santa isabel)$/i.test(n));
        }
      }
    } catch {
      // JSON-LD inválido: se ignora.
    }
  }
  return { product, breadcrumbs };
}

/** Extrae una ficha completa desde el HTML de /{slug}/p. `ean` elige el SKU correcto si hay varios. */
export function parseProductPage(store: StoreId, slug: string, html: string, ean?: string): StoreProduct | null {
  const payload = extractRscPayload(html);
  const specs = parseSpecifications(payload);
  const items = parseItems(payload);
  const { product: ld, breadcrumbs } = parseJsonLd(html);

  const item = (ean ? items.find((i) => i.ean === ean) : undefined) ?? items[0];
  const gtin = item?.ean ?? ld?.gtin13 ?? ld?.gtin;
  if (!gtin) return null;

  const spec = (key: string) => specs.get(key)?.[0]?.trim() || null;
  const netContent = spec('Contenido Neto');
  const portionText = spec('portion');
  const ingredients = spec('ingredients');
  const dietaryTags = (specs.get('alimentaryConditions') ?? []).map((t) => t.trim()).filter(Boolean);
  const liquidHint = normalizeText(`${netContent ?? ''} ${portionText ?? ''}`);
  const brand = typeof ld?.brand === 'string' ? ld.brand : ld?.brand?.name;
  const image = Array.isArray(ld?.image) ? ld?.image[0] : ld?.image;

  return {
    store,
    ean: gtin,
    sku: item?.sku ?? '',
    slug,
    url: `${storeConfig(store).origin}/${slug}/p`,
    name: item?.name ?? ld?.name ?? slug,
    brand: brand?.trim() || 'Sin marca',
    imageUrl: image ?? null,
    categoryNames: breadcrumbs.slice(0, -1),
    ingredientsRaw: ingredients,
    nutrients: parseNutritionTable(payload, specs),
    portionText,
    portionSize: parsePortionSize(portionText),
    netContent,
    isLiquid: /\b\d+([.,]\d+)?\s?(ml|cc|lt?|litros?)\b/.test(liquidHint),
    dietaryTags,
    price: item?.price ?? ld?.offers?.price ?? null,
    listPrice: item?.listPrice ?? null,
    ppumPrice: item?.ppumPrice ?? null,
    ppumUnit: item?.ppumUnit ?? null,
    available: item ? item.stock : ld?.offers?.availability?.endsWith('InStock') !== false,
  };
}

export async function fetchProductPage(
  store: StoreId,
  slug: string,
  opts: { ean?: string; timeoutMs?: number } = {},
): Promise<StoreProduct | null> {
  try {
    const res = await fetch(`${storeConfig(store).origin}/${slug}/p`, {
      headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    if (!res.ok) return null;
    return parseProductPage(store, slug, await res.text(), opts.ean);
  } catch {
    return null;
  }
}

/** URL que agrega uno o varios SKU al carro del supermercado. */
export function cartUrl(store: StoreId, items: { sku: string; qty?: number }[]): string {
  const { origin } = storeConfig(store);
  const valid = items.filter((i) => /^\d+$/.test(i.sku));
  const skus = valid.map((i) => i.sku).join(',');
  const qty = valid.map((i) => Math.max(1, Math.round(i.qty ?? 1))).join(',');
  return `${origin}/?sku=${skus}&qty=${qty}`;
}
