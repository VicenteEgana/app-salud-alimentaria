/**
 * Reportes para el panel de moderación. Protegido con `x-admin-secret` porque incluye correos.
 *   GET  ?status=nuevo|revisado
 *   POST { id, status: 'revisado' }
 */
import type { APIRoute } from 'astro';
import { getReports } from '../../../lib/db';
import { json, jsonError, safeEqual } from '../../../lib/http';

function authorized(request: Request, secret: string | undefined): Response | null {
  if (!secret) return jsonError('ADMIN_SECRET no está configurado', 503);
  if (!safeEqual(request.headers.get('x-admin-secret') ?? '', secret)) return jsonError('No autorizado', 401);
  return null;
}

export const GET: APIRoute = async ({ request, url, locals }) => {
  const env = locals.runtime.env;
  const denied = authorized(request, env.ADMIN_SECRET);
  if (denied) return denied;
  const status = url.searchParams.get('status') === 'revisado' ? 'revisado' : 'nuevo';
  return json({ reports: await getReports(env.DB, status) }, 200, { 'Cache-Control': 'no-store' });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const denied = authorized(request, env.ADMIN_SECRET);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== 'number') return jsonError('id inválido', 400);
  await env.DB.prepare("UPDATE reports SET status = 'revisado' WHERE id = ?").bind(body.id).run();
  return json({ ok: true });
};
