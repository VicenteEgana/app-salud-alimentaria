/**
 * Estado que vive solo en el dispositivo (web y app): "Mi lista" y el paquete sin conexión.
 * Todo acceso a localStorage va en try/catch: puede no estar disponible (modo privado, cuota llena).
 */
import type { Offer, Product } from './db';

export interface SavedItem {
  ean: string;
  slug: string;
  name: string;
  brand: string;
  score: number;
  isFakeHealthy: boolean;
  qty: number;
  savedAt: string;
  /** Oferta de Jumbo al momento de guardar (para armar el carro). */
  jumboSku?: string;
  jumboPrice?: number;
}

const LIST_KEY = 'sanopasillo:lista';
const CHANGES_SEEN_KEY = 'sanopasillo:lista:cambios-vistos';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadList = () => read<SavedItem[]>(LIST_KEY, []);
export const saveList = (items: SavedItem[]) => write(LIST_KEY, items);
export const isSaved = (ean: string) => loadList().some((i) => i.ean === ean);

export function toSavedItem(product: Product, offers: Offer[] = [], qty = 1): SavedItem {
  const jumbo = offers.find((o) => o.store === 'jumbo' && o.available);
  return {
    ean: product.ean,
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    score: product.finalScore,
    isFakeHealthy: product.isFakeHealthy,
    qty,
    savedAt: new Date().toISOString(),
    jumboSku: jumbo?.sku,
    jumboPrice: jumbo?.price,
  };
}

/** Agrega o quita un producto de la lista. Devuelve true si quedó guardado. */
export function toggleSaved(product: Product, offers: Offer[] = []): boolean {
  const list = loadList();
  const index = list.findIndex((i) => i.ean === product.ean);
  if (index >= 0) {
    list.splice(index, 1);
    saveList(list);
    return false;
  }
  list.unshift(toSavedItem(product, offers));
  saveList(list);
  return true;
}

export const loadChangesSeen = () => read<string>(CHANGES_SEEN_KEY, '');
export const saveChangesSeen = (sqliteDate: string) => write(CHANGES_SEEN_KEY, sqliteDate);

// ---------------------------------------------------------------------------
// Paquete sin conexión
// ---------------------------------------------------------------------------

export interface OfflineItem {
  e: string;
  s: string;
  n: string;
  b: string;
  sc: number;
  nv: number;
  se: number;
  f: 0 | 1;
  a: string[];
}

interface OfflinePack {
  generatedAt: string;
  savedAt: string;
  items: OfflineItem[];
}

const PACK_KEY = 'sanopasillo:offline-pack';
const PACK_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export function offlinePackInfo(): { savedAt: string; count: number } | null {
  const pack = read<OfflinePack | null>(PACK_KEY, null);
  return pack ? { savedAt: pack.savedAt, count: pack.items.length } : null;
}

/** Descarga el paquete si no existe o tiene más de 7 días. Silencioso si falla. */
export async function refreshOfflinePack(apiBase: string, force = false): Promise<void> {
  const pack = read<OfflinePack | null>(PACK_KEY, null);
  if (!force && pack && Date.now() - Date.parse(pack.savedAt) < PACK_MAX_AGE_MS) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try {
    const res = await fetch(`${apiBase}/api/offline-pack`);
    if (!res.ok) return;
    const data = (await res.json()) as { generatedAt: string; items: OfflineItem[] };
    write(PACK_KEY, { ...data, savedAt: new Date().toISOString() } satisfies OfflinePack);
  } catch {
    // Sin red: se reintenta en la próxima visita.
  }
}

export function lookupOffline(ean: string): OfflineItem | null {
  return read<OfflinePack | null>(PACK_KEY, null)?.items.find((i) => i.e === ean) ?? null;
}
