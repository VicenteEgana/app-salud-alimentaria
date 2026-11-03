import { defineMiddleware } from 'astro:middleware';

/**
 * CORS para la API pública: la app de Capacitor la llama desde capacitor://localhost
 * (iOS) o https://localhost (Android). Los endpoints de admin quedan fuera.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const isPublicApi = pathname.startsWith('/api/') && !pathname.startsWith('/api/admin/');
  if (!isPublicApi) return next();

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const response = await next();
  for (const [key, value] of Object.entries(CORS_HEADERS)) response.headers.set(key, value);
  return response;
});
