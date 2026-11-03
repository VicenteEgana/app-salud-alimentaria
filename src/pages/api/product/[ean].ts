/**
 * Cascada de búsqueda por código de barras:
 *   Nivel 1: D1 → Nivel 2: Open Food Facts + Jumbo en vivo, se evalúa y se guarda verificado
 *   → 404 (el cliente ofrece el nivel 3: foto de la etiqueta a /api/analyze-label).
 */
import type { APIRoute } from 'astro';
import { json, jsonError } from '../../../lib/http';
import { lookupProduct } from '../../../lib/lookup';
import { isValidEan } from '../../../lib/text';

export const GET: APIRoute = async ({ params, locals }) => {
  const ean = params.ean?.trim() ?? '';
  if (!isValidEan(ean)) return jsonError('Código de barras inválido', 400);

  const result = await lookupProduct(locals.runtime.env.DB, ean);
  if (!result) return jsonError('Producto no encontrado', 404);

  return json(
    result,
    result.source === 'database' ? 200 : 201,
    result.source === 'database' ? { 'Cache-Control': 'public, max-age=60, s-maxage=300' } : {},
  );
};
