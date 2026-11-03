/**
 * Reportes: error en los datos de un producto, solicitud de revisión de una marca (derecho a réplica)
 * o contacto de empresas. Los datos de contacto solo los ve el equipo en /admin/pendientes.
 */
import type { APIRoute } from 'astro';
import { insertReport, type ReportKind } from '../../lib/db';
import { json, jsonError } from '../../lib/http';
import { clientIp, consumeRateLimit, hashIdentifier } from '../../lib/rate-limit';
import { isValidEan } from '../../lib/text';

const KINDS: ReportKind[] = ['error', 'marca', 'empresa'];
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError('Cuerpo JSON inválido', 400);
  }

  const kind = clean(body.kind, 20) as ReportKind;
  const ean = clean(body.ean, 14);
  const message = clean(body.message, 4000);
  const email = clean(body.email, 200);
  if (!KINDS.includes(kind)) return jsonError('Tipo de reporte inválido', 400);
  if (message.length < 10) return jsonError('Cuéntanos un poco más (mínimo 10 caracteres)', 400);
  if (ean && !isValidEan(ean)) return jsonError('Código de barras inválido', 400);
  if ((kind === 'marca' || kind === 'empresa') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return jsonError('Necesitamos un correo válido para responderte', 400);
  }
  // Honeypot: los bots llenan el campo oculto "website".
  if (clean(body.website, 200)) return json({ ok: true });

  const limit = await consumeRateLimit(db, `report:${await hashIdentifier(clientIp(request))}`, 5, 3600);
  if (!limit.allowed) return jsonError('Demasiados envíos. Inténtalo en una hora.', 429);

  await insertReport(db, {
    kind,
    ean: ean || null,
    name: clean(body.name, 120) || null,
    email: email || null,
    organization: clean(body.organization, 160) || null,
    message,
  });
  return json({ ok: true }, 201);
};
