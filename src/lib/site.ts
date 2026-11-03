/** Configuración global del sitio. El nombre es configurable. */
export const SITE_NAME = 'SanoPasillo';
export const SITE_TAGLINE = 'Lo que los sellos no te cuentan';
export const SITE_URL = (import.meta.env.PUBLIC_SITE_URL ?? 'https://sanopasillo.cl').replace(/\/$/, '');

/** true en el build estático que se empaqueta con Capacitor. */
export const IS_APP = import.meta.env.BUILD_TARGET === 'capacitor';

/** La web llama a su propia API (mismo origen); la app llama a la API de producción. */
export const API_BASE = IS_APP
  ? (import.meta.env.PUBLIC_API_BASE_URL ?? SITE_URL).replace(/\/$/, '')
  : '';

/** Páginas que no dependen de la base de datos y por eso también van empaquetadas en la app. */
export const STATIC_PAGES = ['/', '/escanear', '/lista', '/perfil', '/metodologia', '/reportar', '/empresas'] as const;

/**
 * Enlace interno. En la app solo existen las páginas estáticas; el resto (fichas, rankings,
 * comparativas) son SSR y se abren en la web. Acepta query string: href('/reportar?ean=1').
 */
export function href(path: string): string {
  if (!IS_APP) return path;
  const [pathname = '/', query] = path.split('?');
  if ((STATIC_PAGES as readonly string[]).includes(pathname)) {
    const file = pathname === '/' ? '/index.html' : `${pathname}.html`;
    return query ? `${file}?${query}` : file;
  }
  return SITE_URL + path;
}

export const TURNSTILE_SITE_KEY = IS_APP ? undefined : import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
