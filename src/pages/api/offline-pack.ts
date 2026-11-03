/**
 * Paquete compacto de productos verificados para el modo sin conexión del escáner.
 * El cliente lo guarda en localStorage y lo refresca cada 7 días.
 */
import type { APIRoute } from 'astro';
import type { OfflineItem } from '../../lib/client-store';
import { json } from '../../lib/http';

const PACK_SIZE = 3000;

export const GET: APIRoute = async ({ locals }) => {
  const { results } = await locals.runtime.env.DB.prepare(
    `SELECT ean, slug, name, brand, final_score, seals_count, is_fake_healthy,
            json_extract(evaluation_json, '$.novaGroup') AS nova,
            (SELECT json_group_array(json_extract(a.value, '$.id'))
               FROM json_each(json_extract(evaluation_json, '$.additives')) a) AS additive_ids
     FROM products WHERE verified = 1
     ORDER BY updated_at DESC LIMIT ?`,
  )
    .bind(PACK_SIZE)
    .all<{
      ean: string;
      slug: string;
      name: string;
      brand: string;
      final_score: number;
      seals_count: number;
      is_fake_healthy: number;
      nova: number;
      additive_ids: string;
    }>();

  const items: OfflineItem[] = results.map((r) => ({
    e: r.ean,
    s: r.slug,
    n: r.name,
    b: r.brand,
    sc: r.final_score,
    nv: r.nova,
    se: r.seals_count,
    f: r.is_fake_healthy ? 1 : 0,
    a: JSON.parse(r.additive_ids || '[]') as string[],
  }));
  return json(
    { generatedAt: new Date().toISOString(), items },
    200,
    { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
  );
};
