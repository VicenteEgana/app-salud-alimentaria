/**
 * Moderación de escaneos pendientes. Protegido con el header `x-admin-secret`.
 *   { action: 'approve', ean, product: { name, brand, categorySlug, isLiquid, ingredientsRaw, nutrients } }
 *     → recalcula evaluateProduct(), genera el slug definitivo y deja verified = 1.
 *   { action: 'reject', ean } → elimina el escaneo pendiente.
 */
import type { APIRoute } from 'astro';
import { buildRow, getProductByEan, productToInput, uniqueSlug, upsertProduct, type ProductInput } from '../../../lib/db';
import { json, jsonError, safeEqual } from '../../../lib/http';
import type { Nutrients } from '../../../lib/scorer';
import { slugify } from '../../../lib/text';

const NUTRIENT_KEYS = ['calories', 'sugars', 'saturatedFat', 'sodium', 'protein', 'fiber'] as const;

function parseEdits(raw: unknown): Partial<ProductInput> | string {
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null) return 'product debe ser un objeto';
  const p = raw as Record<string, unknown>;
  const edits: Partial<ProductInput> = {};

  for (const key of ['name', 'brand', 'ingredientsRaw'] as const) {
    if (p[key] === undefined) continue;
    if (typeof p[key] !== 'string' || !p[key].trim()) return `${key} no puede estar vacío`;
    edits[key] = p[key].trim();
  }
  if (p.categorySlug !== undefined) {
    const slug = typeof p.categorySlug === 'string' ? slugify(p.categorySlug) : '';
    if (!slug) return 'categorySlug inválido';
    edits.categorySlug = slug;
  }
  if (p.isLiquid !== undefined) edits.isLiquid = p.isLiquid === true;
  if (p.nutrients !== undefined) {
    if (typeof p.nutrients !== 'object' || p.nutrients === null) return 'nutrients debe ser un objeto';
    const n = p.nutrients as Record<string, unknown>;
    const nutrients = {} as Nutrients;
    for (const key of NUTRIENT_KEYS) {
      const value = typeof n[key] === 'string' ? Number.parseFloat(n[key]) : n[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return `Nutriente inválido: ${key}`;
      nutrients[key] = value;
    }
    edits.nutrients = nutrients;
  }
  return edits;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!env.ADMIN_SECRET) return jsonError('ADMIN_SECRET no está configurado', 503);
  if (!safeEqual(request.headers.get('x-admin-secret') ?? '', env.ADMIN_SECRET)) {
    return jsonError('No autorizado', 401);
  }

  let body: { action?: unknown; ean?: unknown; product?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError('Cuerpo JSON inválido', 400);
  }

  const ean = typeof body.ean === 'string' ? body.ean : '';
  const existing = ean ? await getProductByEan(env.DB, ean) : null;
  if (!existing) return jsonError('Producto no encontrado', 404);

  if (body.action === 'reject') {
    if (existing.verified) return jsonError('Solo se pueden rechazar escaneos pendientes', 409);
    await env.DB.prepare('DELETE FROM products WHERE ean = ? AND verified = 0').bind(ean).run();
    return json({ ok: true, ean, action: 'reject' });
  }
  if (body.action !== 'approve') return jsonError('action debe ser "approve" o "reject"', 400);

  const edits = parseEdits(body.product);
  if (typeof edits === 'string') return jsonError(edits, 400);

  const input: ProductInput = {
    ...productToInput(existing),
    ...edits,
    ean,
    // Un escaneo revisado por el equipo pasa a ser fuente "moderación"; un producto de catálogo conserva su fuente.
    dataSource: existing.dataSource === 'ia-usuario' ? 'moderacion' : existing.dataSource,
  };

  const slug = await uniqueSlug(env.DB, input);
  const product = await upsertProduct(
    env.DB,
    buildRow(input, { slug, verified: true, scanConsensusCount: existing.scanConsensusCount }),
  );
  return json({ ok: true, action: 'approve', product });
};
