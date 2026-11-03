/** Productos por lote (para refrescar "Mi lista" en web y app): /api/products?eans=780…,780… */
import type { APIRoute } from 'astro';
import { getOffers, getProductByEan } from '../../lib/db';
import { json } from '../../lib/http';
import { isValidEan } from '../../lib/text';

const MAX_EANS = 60;

export const GET: APIRoute = async ({ url, locals }) => {
  const db = locals.runtime.env.DB;
  const eans = [...new Set((url.searchParams.get('eans') ?? '').split(',').map((s) => s.trim()))]
    .filter(isValidEan)
    .slice(0, MAX_EANS);
  const [products, offers] = await Promise.all([
    Promise.all(eans.map((ean) => getProductByEan(db, ean))),
    getOffers(db, eans),
  ]);
  return json({
    products: products.filter((p) => p !== null).map((p) => ({ product: p, offers: offers.get(p.ean) ?? [] })),
  });
};
