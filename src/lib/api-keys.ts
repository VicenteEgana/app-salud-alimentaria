/** Autenticación de la API B2B con `x-api-key`. En D1 solo se guarda el hash SHA-256 de la clave. */
import { jsonError } from './http';

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ApiClient {
  clientName: string;
  usageCount: number;
  monthlyQuota: number;
}

/**
 * Valida la clave, aplica la cuota mensual y registra el uso.
 * Devuelve el cliente o una Response de error lista para retornar.
 */
export async function authenticateApiKey(db: D1Database, request: Request): Promise<ApiClient | Response> {
  const key = request.headers.get('x-api-key')?.trim() ?? '';
  if (!/^sp_[A-Za-z0-9_-]{20,}$/.test(key)) return jsonError('Falta una x-api-key válida', 401);

  const month = new Date().toISOString().slice(0, 7);
  const row = await db
    .prepare(
      `UPDATE api_keys
       SET usage_count = CASE WHEN usage_month = ?1 THEN usage_count + 1 ELSE 1 END,
           usage_month = ?1, last_used_at = CURRENT_TIMESTAMP
       WHERE key_hash = ?2 AND active = 1
       RETURNING client_name AS clientName, usage_count AS usageCount, monthly_quota AS monthlyQuota`,
    )
    .bind(month, await sha256Hex(key))
    .first<ApiClient>();

  if (!row) return jsonError('x-api-key inválida o desactivada', 401);
  if (row.usageCount > row.monthlyQuota) return jsonError('Cuota mensual agotada', 429);
  return row;
}
