/**
 * Catálogo explorable: tipos y parámetros compartidos por la API (/api/products/search), el SSR de
 * /productos y /comparar, y el navegador (web y app de Capacitor). Sin dependencias de runtime: lo usan
 * también los scripts de Node a través de db.ts.
 */
import type { Product } from './db';
import type { MinsalSeal, NovaGroup } from './scorer';

/** Versión liviana de un producto para grillas, buscadores y la barra de comparación. */
export interface ProductSummary {
  ean: string;
  slug: string;
  name: string;
  brand: string;
  categorySlug: string;
  finalScore: number;
  novaGroup: NovaGroup;
  sealsCount: number;
  seals: MinsalSeal[];
  isFakeHealthy: boolean;
  additivesCount: number;
  imageUrl: string | null;
}

export const CATALOG_FILTERS = ['top', 'fake_healthy', 'real_food', 'no_seals'] as const;
export type CatalogFilter = (typeof CATALOG_FILTERS)[number];

export const CATALOG_SORTS = ['score_desc', 'score_asc', 'additives'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/** Puntaje mínimo del filtro "Mejor evaluados" (el mismo corte que "Puntaje alto"). */
export const TOP_SCORE = 75;

/** Textos cortos para que los 4 filtros quepan en 2 filas en un teléfono. */
export const FILTER_LABELS: Record<CatalogFilter, string> = {
  top: '🏆 Mejor evaluados',
  fake_healthy: '⚠️ Falsos sin sellos',
  real_food: '🟢 Comida real (NOVA 1-2)',
  no_seals: '⚫ Libre de sellos',
};

export const FILTER_HINTS: Record<CatalogFilter, string> = {
  top: `Puntaje ${TOP_SCORE} o más`,
  fake_healthy: '0 sellos MINSAL, pero ultraprocesados con aditivos o edulcorantes',
  real_food: 'Alimentos naturales o mínimamente procesados (NOVA 1 y 2)',
  no_seals: 'Sin ningún sello "ALTO EN" del MINSAL',
};

export const SORT_LABELS: Record<CatalogSort, string> = {
  score_desc: 'Mayor puntaje',
  score_asc: 'Menor puntaje',
  additives: 'Menos aditivos',
};

export interface CatalogQuery {
  /** Texto libre: nombre, marca o EAN. */
  q: string;
  /** Slug de categoría; vacío = todas. */
  category: string;
  /** Filtros rápidos; se combinan con Y. */
  filters: CatalogFilter[];
  sort: CatalogSort;
  limit: number;
  offset: number;
}

export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 60;
const MAX_OFFSET = 10_000;

const isFilter = (s: string): s is CatalogFilter => (CATALOG_FILTERS as readonly string[]).includes(s);
const isSort = (s: string | null): s is CatalogSort => s !== null && (CATALOG_SORTS as readonly string[]).includes(s);

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Lee la consulta desde la URL. Valores desconocidos (ej. filter=all) se ignoran. */
export function parseCatalogQuery(params: URLSearchParams): CatalogQuery {
  const category = (params.get('category') ?? '').trim();
  const sort = params.get('sort');
  return {
    q: (params.get('q') ?? '').trim().slice(0, 60),
    category: /^[a-z0-9-]{1,80}$/.test(category) ? category : '',
    filters: [...new Set((params.get('filter') ?? '').split(',').map((s) => s.trim()))].filter(isFilter),
    sort: isSort(sort) ? sort : 'score_desc',
    limit: clampInt(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: clampInt(params.get('offset'), 0, 0, MAX_OFFSET),
  };
}

/** Query string de una consulta, sin los valores por defecto (URLs cortas y cacheables). */
export function catalogParams(query: Partial<CatalogQuery>): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.filters?.length) params.set('filter', query.filters.join(','));
  if (query.sort && query.sort !== 'score_desc') params.set('sort', query.sort);
  if (query.limit !== undefined && query.limit !== DEFAULT_LIMIT) params.set('limit', String(query.limit));
  if (query.offset) params.set('offset', String(query.offset));
  return params;
}

export function toSummary(p: Product): ProductSummary {
  return {
    ean: p.ean,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    categorySlug: p.categorySlug,
    finalScore: p.finalScore,
    novaGroup: p.evaluation.novaGroup,
    sealsCount: p.evaluation.minsalSeals.length,
    seals: p.evaluation.minsalSeals,
    isFakeHealthy: p.isFakeHealthy,
    additivesCount: p.evaluation.additives.length,
    imageUrl: p.imageUrl,
  };
}

// ---------------------------------------------------------------------------
// Comparativas sugeridas
// ---------------------------------------------------------------------------

export interface VersusSuggestion {
  categorySlug: string;
  /** Uno de los mejor evaluados de la categoría. */
  best: ProductSummary;
  /** Un "falso sin sellos" de la misma categoría. */
  trap: ProductSummary;
}

/**
 * Cruza los mejores de cada categoría con sus falsos sin sellos (el i-ésimo mejor con la i-ésima trampa
 * de peor puntaje). Reparte por rondas para que las primeras sugerencias cubran todas las categorías.
 */
export function pairSuggestions(best: ProductSummary[], traps: ProductSummary[], max = 6): VersusSuggestion[] {
  const group = (items: ProductSummary[]) => {
    const map = new Map<string, ProductSummary[]>();
    for (const p of items) map.set(p.categorySlug, [...(map.get(p.categorySlug) ?? []), p]);
    return map;
  };
  const bestBy = group(best);
  const trapsBy = group(traps);
  const rounds = Math.max(0, ...[...bestBy.values()].map((list) => list.length));
  const out: VersusSuggestion[] = [];
  for (let i = 0; i < rounds; i++) {
    for (const [categorySlug, list] of bestBy) {
      const b = list[i];
      const t = trapsBy.get(categorySlug)?.[i];
      if (b && t && b.ean !== t.ean && b.finalScore > t.finalScore) out.push({ categorySlug, best: b, trap: t });
    }
  }
  return out.slice(0, max);
}
