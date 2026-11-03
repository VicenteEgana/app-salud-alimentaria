/**
 * Cascada nivel 3: el usuario fotografía la etiqueta de un producto que no está en ningún catálogo.
 * Gemini extrae ingredientes + tabla por 100 g/ml, se valida, se evalúa y se guarda con verified = 0.
 * Si un segundo escaneo independiente coincide (±5 % en calorías y azúcares) se aprueba por consenso.
 *
 * Límites (cada llamada cuesta cuota de Gemini): por IP por hora —más alto con token de Turnstile— y
 * un tope global diario. Ver src/lib/lookup.ts.
 */
import type { APIRoute } from 'astro';
import { json, jsonError } from '../../lib/http';
import { analyzeLabelAndStore } from '../../lib/lookup';
import { clientIp, hashIdentifier, toInt, verifyTurnstile } from '../../lib/rate-limit';
import { isValidEan } from '../../lib/text';

/** ~1.5 MB de imagen. El cliente comprime a < 120 KB; esto solo frena abusos. */
const MAX_BASE64_LENGTH = 2_000_000;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let body: { ean?: unknown; productNameHint?: unknown; imageBase64?: unknown; turnstileToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError('Cuerpo JSON inválido', 400);
  }

  const ean = typeof body.ean === 'string' ? body.ean.trim() : '';
  const hint = typeof body.productNameHint === 'string' ? body.productNameHint.trim() : '';
  const rawImage = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  if (!isValidEan(ean)) return jsonError('Código de barras inválido', 400);

  const dataUrl = rawImage.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
  const mimeType = dataUrl?.[1] ?? 'image/jpeg';
  const imageBase64 = dataUrl?.[2] ?? rawImage;
  if (!imageBase64 || !/^[A-Za-z0-9+/=\s]+$/.test(imageBase64)) return jsonError('Imagen inválida', 400);
  if (imageBase64.length > MAX_BASE64_LENGTH) return jsonError('La imagen es demasiado grande', 413);

  const ip = clientIp(request);
  const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';
  const human = Boolean(env.TURNSTILE_SECRET_KEY && token && (await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, ip)));
  const perIpLimit = human
    ? toInt(env.ANALYZE_LIMIT_PER_IP_HOUR, 10)
    : toInt(env.ANALYZE_LIMIT_PER_IP_HOUR_NO_CAPTCHA, env.TURNSTILE_SECRET_KEY ? 3 : 10);

  const result = await analyzeLabelAndStore(
    env,
    { ean, hint, imageBase64, mimeType },
    [{ bucket: `analyze:ip:${await hashIdentifier(ip)}`, limit: perIpLimit, windowSeconds: 3600 }],
  );

  if (!result.ok) return json({ error: result.error, code: result.code }, result.httpStatus);
  return json({ product: result.product, status: result.status }, result.status === 'pending' ? 201 : 200);
};
