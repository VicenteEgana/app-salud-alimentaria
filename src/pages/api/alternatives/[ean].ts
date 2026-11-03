/** Alternativas verificadas con mejor puntaje en la misma categoría, con precios (para "Mejorar mi lista"). */
import type { APIRoute } from 'astro';
import { getHealthierAlternatives, getOffers, getProductByEan } from '../../../lib/db';
import { json, jsonError } from '../../../lib/http';
import { isValidEan } from '../../../lib/text';

export const GET: APIRoute = async ({ params, locals }) => {
  const ean = params.ean ?? '';
  if (!isValidEan(ean)) return jsonError('Código de barras inválido', 400);
  const db = locals.runtime.env.DB;
  const product = await getProductByEan(db, ean);
  if (!product) return jsonError('Producto no encontrado', 404);

  const alternatives = await getHealthierAlternatives(db, product, 3);
  const offers = await getOffers(db, alternatives.map((a) => a.ean));
  return json(
    { alternatives: alternatives.map((a) => ({ product: a, offers: offers.get(a.ean) ?? [] })) },
    200,
    { 'Cache-Control': 'public, max-age=300, s-maxage=3600' },
  );
};
