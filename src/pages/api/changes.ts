/**
 * Reformulaciones recientes. Sin parámetros: las últimas de cualquier producto.
 * ?eans=a,b&since=2026-10-01 00:00:00 → solo las de esos productos (alertas de "Mi lista").
 */
import type { APIRoute } from 'astro';
import { getRecentHistory } from '../../lib/db';
import { describeChange } from '../../lib/history';
import { json } from '../../lib/http';
import { isValidEan } from '../../lib/text';

export const GET: APIRoute = async ({ url, locals }) => {
  const eans = (url.searchParams.get('eans') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(isValidEan);
  const since = url.searchParams.get('since')?.slice(0, 19) || undefined;
  const rows = await getRecentHistory(locals.runtime.env.DB, { eans: eans.length ? eans : undefined, since, limit: 50 });
  const changes = rows
    .map(({ entry, product }) => ({
      ean: product.ean,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      changedAt: entry.changedAt,
      oldScore: entry.oldScore,
      newScore: entry.newScore,
      summary: describeChange(entry),
    }))
    .filter((c) => c.summary.length > 0);
  return json({ changes }, 200, { 'Cache-Control': 'public, max-age=300' });
};
