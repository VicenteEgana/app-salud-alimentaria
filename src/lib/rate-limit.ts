/**
 * Rate limiting en D1 con ventanas fijas. Las IP nunca se guardan en claro: el bucket usa un hash.
 * No es exacto bajo carrera extrema, pero basta para frenar abusos del endpoint de IA (que cuesta dinero).
 */

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  resetAt: number;
}

export async function consumeRateLimit(
  db: D1Database,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(bucket, windowStart)
    .first<{ count: number }>();

  // Limpieza ocasional de ventanas viejas (> 2 días).
  if (Math.random() < 0.01) {
    await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - 2 * 86400).run();
  }

  const count = row?.count ?? 1;
  return { allowed: count <= limit, count, limit, resetAt: windowStart + windowSeconds };
}

/** IP del cliente según Cloudflare; "local" en desarrollo. */
export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  );
}

export async function hashIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sanopasillo:${value}`));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verificación de Cloudflare Turnstile. */
export async function verifyTurnstile(secret: string, token: string, ip?: string): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new FormData();
    body.append('secret', secret);
    body.append('response', token);
    if (ip && ip !== 'local') body.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export const toInt = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
