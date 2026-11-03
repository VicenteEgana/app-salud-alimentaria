/**
 * Búsqueda del catálogo (web y app): productos verificados por nombre, marca, categoría o EAN.
 * /api/products/search?q=&category=&filter=top,fake_healthy,real_food,no_seals&sort=score_desc|score_asc|additives&limit=24&offset=0
 * Responde un arreglo de ProductSummary; el total va en el header X-Total-Count (para "Cargar más").
 */
import type { APIRoute } from 'astro';
import { parseCatalogQuery } from '../../../lib/catalog';
import { searchCatalog } from '../../../lib/db';
import { json } from '../../../lib/http';

export const GET: APIRoute = async ({ url, locals }) => {
  const query = parseCatalogQuery(url.searchParams);
  const { items, total } = await searchCatalog(locals.runtime.env.DB, query);
  return json(items, 200, {
    'X-Total-Count': String(total),
    'Cache-Control': 'public, max-age=60, s-maxage=300',
  });
};
