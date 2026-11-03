/** API B2B v1: evaluación completa de un producto por EAN. Requiere `x-api-key`. */
import type { APIRoute } from 'astro';
import { authenticateApiKey } from '../../../../lib/api-keys';
import { toB2BProduct } from '../../../../lib/b2b';
import { json, jsonError } from '../../../../lib/http';
import { lookupProduct } from '../../../../lib/lookup';
import { isValidEan } from '../../../../lib/text';

export const GET: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB;
  const client = await authenticateApiKey(db, request);
  if (client instanceof Response) return client;

  const ean = params.ean ?? '';
  if (!isValidEan(ean)) return jsonError('Código de barras inválido', 400);
  const result = await lookupProduct(db, ean);
  if (!result) return jsonError('Producto no encontrado', 404);

  return json({ data: toB2BProduct(result.product, result.offers) }, 200, {
    'X-Quota-Used': String(client.usageCount),
    'X-Quota-Limit': String(client.monthlyQuota),
  });
};
