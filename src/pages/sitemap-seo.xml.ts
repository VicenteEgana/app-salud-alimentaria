/** Sitemap dinámico: home, rankings, productos verificados y cruces versus entre el Top 8 de cada categoría. */
import type { APIRoute } from 'astro';
import { getCategorySummaries, getTopSlugsByCategory, getVerifiedSlugs } from '../lib/db';
import { SITE_URL } from '../lib/site';
import { escapeHtml } from '../lib/text';
import { allPairs, versusPath } from '../lib/versus';

const VERSUS_TOP_N = 8;

const toW3cDate = (sqlite: string) => (sqlite ? new Date(`${sqlite.replace(' ', 'T')}Z`).toISOString().slice(0, 10) : undefined);

function urlEntry(path: string, opts: { lastmod?: string; changefreq?: string; priority?: string } = {}): string {
  return [
    '<url>',
    `<loc>${escapeHtml(SITE_URL + path)}</loc>`,
    opts.lastmod && `<lastmod>${opts.lastmod}</lastmod>`,
    opts.changefreq && `<changefreq>${opts.changefreq}</changefreq>`,
    opts.priority && `<priority>${opts.priority}</priority>`,
    '</url>',
  ]
    .filter(Boolean)
    .join('');
}

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const [categories, products, topByCategory] = await Promise.all([
    getCategorySummaries(db),
    getVerifiedSlugs(db),
    getTopSlugsByCategory(db, VERSUS_TOP_N),
  ]);

  const entries = [
    urlEntry('/', { changefreq: 'daily', priority: '1.0' }),
    urlEntry('/escanear', { changefreq: 'monthly', priority: '0.6' }),
    urlEntry('/metodologia', { changefreq: 'monthly', priority: '0.5' }),
    urlEntry('/reformulaciones', { changefreq: 'daily', priority: '0.6' }),
    urlEntry('/empresas', { changefreq: 'monthly', priority: '0.3' }),
    ...categories.map((c) => urlEntry(`/ranking/${c.categorySlug}`, { changefreq: 'daily', priority: '0.9' })),
    ...products.map((p) => urlEntry(`/producto/${p.slug}`, { lastmod: toW3cDate(p.updated_at), changefreq: 'weekly', priority: '0.7' })),
    ...[...topByCategory.values()].flatMap((slugs) =>
      allPairs(slugs).map(([a, b]) => urlEntry(versusPath(a, b), { changefreq: 'weekly', priority: '0.5' })),
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
