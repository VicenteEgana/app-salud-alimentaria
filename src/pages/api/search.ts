/** Buscador rápido de la home (web y app): productos verificados por nombre, marca o EAN. */
import type { APIRoute } from 'astro';
import { searchProducts } from '../../lib/db';
import { json } from '../../lib/http';

export const GET: APIRoute = async ({ url, locals }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 60);
  if (q.length < 2) return json({ products: [] });
  const products = await searchProducts(locals.runtime.env.DB, q);
  return json({ products }, 200, { 'Cache-Control': 'public, max-age=60, s-maxage=600' });
};
