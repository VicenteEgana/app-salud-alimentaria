/**
 * Cola de comparación: hasta 2 productos elegidos con "+ Comparar", compartidos por la barra flotante,
 * el catálogo, el escáner y /comparar. Vive en localStorage y avisa los cambios con un evento propio.
 */
import type { ProductSummary } from './catalog';
import { escapeHtml } from './text';
import { versusPath } from './versus';

export type CompareItem = Pick<ProductSummary, 'ean' | 'slug' | 'name' | 'brand' | 'categorySlug' | 'finalScore'>;

export const COMPARE_STORAGE_KEY = 'sanopasillo_compare_queue';
export const COMPARE_EVENT = 'sanopasillo:compare-change';
export const MAX_COMPARE = 2;

export function toCompareItem(p: CompareItem): CompareItem {
  return { ean: p.ean, slug: p.slug, name: p.name, brand: p.brand, categorySlug: p.categorySlug, finalScore: p.finalScore };
}

/** Valida un ítem leído de localStorage o de un atributo data-* (puede venir de una versión anterior). */
export function parseCompareItem(raw: unknown): CompareItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const ean = str(r.ean);
  const slug = str(r.slug);
  const name = str(r.name);
  if (!ean || !slug || !name || typeof r.finalScore !== 'number') return null;
  return { ean, slug, name, brand: str(r.brand) ?? '', categorySlug: str(r.categorySlug) ?? '', finalScore: r.finalScore };
}

export function parseQueue(raw: string | null): CompareItem[] {
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  return data
    .map(parseCompareItem)
    .filter((item): item is CompareItem => item !== null && !seen.has(item.ean) && Boolean(seen.add(item.ean)))
    .slice(0, MAX_COMPARE);
}

export const isInQueue = (queue: CompareItem[], ean: string) => queue.some((item) => item.ean === ean);

export const removeItem = (queue: CompareItem[], ean: string) => queue.filter((item) => item.ean !== ean);

/**
 * Agrega o quita. Con la cola llena, el nuevo reemplaza al segundo: el primero queda como referencia,
 * igual que "Cambiar rival".
 */
export function toggleItem(queue: CompareItem[], item: CompareItem): CompareItem[] {
  if (isInQueue(queue, item.ean)) return removeItem(queue, item.ean);
  const next = toCompareItem(item);
  return queue.length < MAX_COMPARE ? [...queue, next] : [queue[0]!, next];
}

/** Pone el producto en una posición fija (selectores A/B de /comparar). */
export function setSlot(queue: CompareItem[], index: 0 | 1, item: CompareItem): CompareItem[] {
  const slots: (CompareItem | undefined)[] = [queue[0], queue[1]];
  slots[index] = toCompareItem(item);
  if (slots[1 - index]?.ean === item.ean) slots[1 - index] = undefined;
  return slots.filter((s): s is CompareItem => s !== undefined);
}

/** Ruta canónica del versus, o null si faltan productos. */
export function queueVersusPath(queue: CompareItem[]): string | null {
  const [a, b] = queue;
  return a && b ? versusPath(a.slug, b.slug) : null;
}

export const mixedCategories = (queue: CompareItem[]) =>
  queue.length === MAX_COMPARE && queue[0]!.categorySlug !== queue[1]!.categorySlug;

/** Valor del atributo data-compare-product (JSON escapado para HTML). */
export const compareAttr = (p: CompareItem) => escapeHtml(JSON.stringify(toCompareItem(p)));

// ---------------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------------

export function loadQueue(): CompareItem[] {
  try {
    return parseQueue(localStorage.getItem(COMPARE_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveQueue(queue: CompareItem[]): void {
  try {
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Modo privado sin almacenamiento: la cola vive solo en esta página.
  }
  window.dispatchEvent(new CustomEvent<CompareItem[]>(COMPARE_EVENT, { detail: queue }));
}

/** Cambios hechos en esta pestaña (evento propio) o en otra (evento storage). */
export function onQueueChange(callback: (queue: CompareItem[]) => void): void {
  window.addEventListener(COMPARE_EVENT, (event) => callback((event as CustomEvent<CompareItem[]>).detail));
  window.addEventListener('storage', (event) => {
    if (event.key === COMPARE_STORAGE_KEY) callback(loadQueue());
  });
}
