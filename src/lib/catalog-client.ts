/** Cliente de /api/products/search para el navegador (mismo origen en la web, API de producción en la app). */
import { catalogParams, type CatalogQuery, type ProductSummary } from './catalog';
import { API_BASE } from './site';

export async function fetchCatalog(
  query: Partial<CatalogQuery>,
  signal?: AbortSignal,
): Promise<{ items: ProductSummary[]; total: number }> {
  const qs = catalogParams(query).toString();
  const res = await fetch(`${API_BASE}/api/products/search${qs ? `?${qs}` : ''}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json()) as ProductSummary[];
  const total = Number(res.headers.get('X-Total-Count'));
  return { items, total: Number.isFinite(total) && res.headers.has('X-Total-Count') ? total : items.length };
}
