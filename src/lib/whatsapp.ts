/**
 * Bot de WhatsApp (WhatsApp Cloud API de Meta).
 *   - Texto con un EAN → puntaje y link a la ficha.
 *   - Texto libre → los 3 mejores resultados de búsqueda.
 *   - Foto con el EAN en la descripción → lectura de etiqueta con IA (mismos límites que la web).
 */
import type { Offer, Product } from './db';
import { NOVA_LABELS } from './scorer';
import { SITE_URL } from './site';
import { formatNumber, isValidEan } from './text';

export interface IncomingMessage {
  id: string;
  from: string;
  type: 'text' | 'image' | 'other';
  text?: string;
  imageId?: string;
  caption?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Extrae los mensajes entrantes del webhook (ignora estados de entrega y otros eventos). */
export function parseWebhook(payload: unknown): IncomingMessage[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];
  const messages: IncomingMessage[] = [];
  for (const entry of payload.entry.filter(isRecord)) {
    for (const change of (Array.isArray(entry.changes) ? entry.changes : []).filter(isRecord)) {
      const value = isRecord(change.value) ? change.value : {};
      for (const m of (Array.isArray(value.messages) ? value.messages : []).filter(isRecord)) {
        const id = typeof m.id === 'string' ? m.id : '';
        const from = typeof m.from === 'string' ? m.from : '';
        if (!id || !from) continue;
        if (m.type === 'text' && isRecord(m.text) && typeof m.text.body === 'string') {
          messages.push({ id, from, type: 'text', text: m.text.body });
        } else if (m.type === 'image' && isRecord(m.image) && typeof m.image.id === 'string') {
          messages.push({
            id,
            from,
            type: 'image',
            imageId: m.image.id,
            caption: typeof m.image.caption === 'string' ? m.image.caption : undefined,
          });
        } else {
          messages.push({ id, from, type: 'other' });
        }
      }
    }
  }
  return messages;
}

/** Valida `X-Hub-Signature-256: sha256=<hex>` (HMAC del cuerpo crudo con el App Secret). */
export async function verifySignature(appSecret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  const received = header.slice(7).toLowerCase();
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

/** EAN dentro de un texto ("7802920010588", "780 2920 010588"). */
export function extractEan(text: string | undefined): string | null {
  if (!text) return null;
  const candidates = text.replace(/[\s-]/g, '').match(/\d{8,14}/g) ?? [];
  return candidates.find(isValidEan) ?? null;
}

export const HELP_TEXT = `Hola 👋 Soy SanoPasillo. Te digo lo que los sellos no cuentan.

• Envíame el *código de barras* (los números bajo las barras), ej: 7802920010588
• O el *nombre* del producto, ej: yogurt protein
• ¿No lo encuentro? Mándame una *foto de la etiqueta* (ingredientes + tabla nutricional) con el código de barras en la descripción.`;

const tierEmoji = (score: number) => (score >= 75 ? '🟢' : score >= 50 ? '🟡' : '🔴');

export function formatProductReply(product: Product, offers: Offer[] = []): string {
  const ev = product.evaluation;
  const lines = [
    `${tierEmoji(product.finalScore)} *${product.name}* (${product.brand})`,
    `Puntaje: *${product.finalScore}/100*`,
    `Sellos MINSAL: ${ev.minsalSeals.length ? ev.minsalSeals.join(', ') : 'ninguno'}`,
    `Procesamiento: NOVA ${ev.novaGroup} (${NOVA_LABELS[ev.novaGroup].toLowerCase()})`,
  ];
  if (product.isFakeHealthy) lines.push('⚠️ *Falso sin sellos*: es ultraprocesado y contiene aditivos o edulcorantes.');
  if (ev.additives.length) lines.push(`Aditivos de riesgo: ${ev.additives.map((a) => a.name).join(', ')}`);
  for (const w of ev.borderlineWarnings) lines.push(`⚠️ ${w}`);
  if (ev.kidsSweetenerWarning) lines.push('👶 Contiene edulcorantes: el MINSAL propone advertir "Evite consumo en niños".');
  const jumbo = offers.find((o) => o.store === 'jumbo' && o.available);
  if (jumbo) {
    lines.push(
      `💲 Jumbo: $${jumbo.price.toLocaleString('es-CL')}${jumbo.ppumPrice ? ` ($${formatNumber(jumbo.ppumPrice)}/${jumbo.ppumUnit ?? 'kg'})` : ''}`,
    );
  }
  if (!product.verified) lines.push('ℹ️ Datos leídos por IA, pendientes de verificación.');
  lines.push('', `Radiografía completa: ${SITE_URL}/producto/${product.slug}`);
  return lines.join('\n');
}

export function formatSearchReply(query: string, products: Product[]): string {
  if (products.length === 0) {
    return `No encontré "${query}". Prueba con el código de barras o envíame una foto de la etiqueta con el código en la descripción.`;
  }
  return [
    `Resultados para "${query}":`,
    ...products.slice(0, 3).map((p) => `${tierEmoji(p.finalScore)} ${p.name} (${p.brand}) — ${p.finalScore}/100\n${SITE_URL}/producto/${p.slug}`),
    '',
    'Envíame el código de barras para ver el detalle de uno.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Cliente Graph API
// ---------------------------------------------------------------------------

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  graphVersion: string;
}

const graph = (cfg: WhatsAppConfig, path: string) => `https://graph.facebook.com/${cfg.graphVersion}/${path}`;

export async function sendText(cfg: WhatsAppConfig, to: string, body: string, replyTo?: string): Promise<void> {
  const res = await fetch(graph(cfg, `${cfg.phoneNumberId}/messages`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: body.slice(0, 4000), preview_url: true },
      ...(replyTo ? { context: { message_id: replyTo } } : {}),
    }),
  });
  if (!res.ok) console.error('WhatsApp sendText', res.status, (await res.text()).slice(0, 300));
}

/** Descarga una imagen recibida y la devuelve en base64. */
export async function downloadMedia(cfg: WhatsAppConfig, mediaId: string): Promise<{ base64: string; mimeType: string } | null> {
  const meta = await fetch(graph(cfg, mediaId), { headers: { Authorization: `Bearer ${cfg.token}` } });
  if (!meta.ok) return null;
  const { url, mime_type } = (await meta.json()) as { url?: string; mime_type?: string };
  if (!url) return null;
  const file = await fetch(url, { headers: { Authorization: `Bearer ${cfg.token}` } });
  if (!file.ok) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 1_500_000) return null;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(binary), mimeType: mime_type?.split(';')[0] ?? 'image/jpeg' };
}
