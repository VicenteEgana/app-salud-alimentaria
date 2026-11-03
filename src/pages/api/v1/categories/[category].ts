/** API B2B v1: ranking verificado de una categoría. Requiere `x-api-key`. */
import type { APIRoute } from 'astro';
import { authenticateApiKey } from '../../../../lib/api-keys';
import { toB2BProduct } from '../../../../lib/b2b';
import { getCategoryProducts, getOffers } from '../../../../lib/db';
import { json } from '../../../../lib/http';

export const GET: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB;
  const client = await authenticateApiKey(db, request);
  if (client instanceof Response) return client;

  const products = (await getCategoryProducts(db, params.category ?? '')).slice(0, 200);
  const offers = await getOffers(db, products.slice(0, 100).map((p) => p.ean));
  return json(
    { data: products.map((p) => toB2BProduct(p, offers.get(p.ean) ?? [])), total: products.length },
    200,
    { 'X-Quota-Used': String(client.usageCount), 'X-Quota-Limit': String(client.monthlyQuota) },
  );
};
