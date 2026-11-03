/**
 * Webhook de WhatsApp Cloud API.
 *   GET  → verificación de suscripción (hub.mode / hub.verify_token / hub.challenge).
 *   POST → mensajes entrantes. Se responde 200 de inmediato y se procesa con waitUntil,
 *          porque Meta reintenta si el webhook tarda.
 */
import type { APIRoute } from 'astro';
import { searchProducts } from '../../lib/db';
import { lookupProduct, analyzeLabelAndStore } from '../../lib/lookup';
import { consumeRateLimit, hashIdentifier } from '../../lib/rate-limit';
import {
  HELP_TEXT,
  downloadMedia,
  extractEan,
  formatProductReply,
  formatSearchReply,
  parseWebhook,
  sendText,
  verifySignature,
  type IncomingMessage,
  type WhatsAppConfig,
} from '../../lib/whatsapp';

export const GET: APIRoute = ({ url, locals }) => {
  const env = locals.runtime.env;
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') ?? '';
  if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
};

async function handleMessage(env: Env, cfg: WhatsAppConfig, msg: IncomingMessage): Promise<void> {
  const phoneHash = await hashIdentifier(msg.from);
  const limit = await consumeRateLimit(env.DB, `whatsapp:${phoneHash}`, 30, 3600);
  if (!limit.allowed) return; // Silencio: no gastar mensajes en quien abusa.

  if (msg.type === 'text') {
    const text = msg.text?.trim() ?? '';
    const ean = extractEan(text);
    if (ean) {
      const result = await lookupProduct(env.DB, ean);
      await sendText(
        cfg,
        msg.from,
        result
          ? formatProductReply(result.product, result.offers)
          : `No encontré el código ${ean}. Mándame una foto de la etiqueta (ingredientes + tabla nutricional) con ese código en la descripción y la leo al instante.`,
        msg.id,
      );
      return;
    }
    if (text.length >= 3 && !/^(hola|ayuda|help|menu|menú|inicio)\b/i.test(text)) {
      await sendText(cfg, msg.from, formatSearchReply(text, await searchProducts(env.DB, text.slice(0, 60), 3)), msg.id);
      return;
    }
    await sendText(cfg, msg.from, HELP_TEXT);
    return;
  }

  if (msg.type === 'image' && msg.imageId) {
    const ean = extractEan(msg.caption);
    if (!ean) {
      await sendText(cfg, msg.from, 'Recibí la foto 📷. Reenvíala con el *código de barras* escrito en la descripción para poder guardarla.', msg.id);
      return;
    }
    const existing = await lookupProduct(env.DB, ean);
    if (existing?.product.verified) {
      await sendText(cfg, msg.from, formatProductReply(existing.product, existing.offers), msg.id);
      return;
    }
    const media = await downloadMedia(cfg, msg.imageId);
    if (!media) {
      await sendText(cfg, msg.from, 'No pude descargar la foto. ¿La puedes enviar de nuevo?', msg.id);
      return;
    }
    const result = await analyzeLabelAndStore(
      env,
      { ean, hint: msg.caption?.replace(ean, '').trim() ?? '', imageBase64: media.base64, mimeType: media.mimeType },
      [{ bucket: `analyze:wa:${phoneHash}`, limit: 5, windowSeconds: 3600 }],
    );
    await sendText(
      cfg,
      msg.from,
      result.ok ? formatProductReply(result.product) : `${result.error}. Prueba con una foto más cercana y con buena luz.`,
      msg.id,
    );
    return;
  }

  await sendText(cfg, msg.from, HELP_TEXT);
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_APP_SECRET) {
    return new Response('WhatsApp no configurado', { status: 503 });
  }
  const raw = await request.text();
  if (!(await verifySignature(env.WHATSAPP_APP_SECRET, raw, request.headers.get('x-hub-signature-256')))) {
    return new Response('Firma inválida', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('JSON inválido', { status: 400 });
  }

  const cfg: WhatsAppConfig = {
    token: env.WHATSAPP_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    graphVersion: env.WHATSAPP_GRAPH_VERSION ?? 'v23.0',
  };
  const work = Promise.all(
    parseWebhook(payload).map((msg) => handleMessage(env, cfg, msg).catch((err) => console.error('whatsapp', err))),
  );
  locals.runtime.ctx.waitUntil(work);
  return new Response('OK', { status: 200 });
};
