// @ts-check
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

const isApp = process.env.BUILD_TARGET === 'capacitor';
const SITE_URL = process.env.PUBLIC_SITE_URL ?? 'https://sanopasillo.cl';

/**
 * Rutas que solo tienen sentido en SSR (leen D1, llaman a Gemini o son dinámicas por slug).
 * En el build de Capacitor se reemplazan por un stub vacío para que no se empaqueten en la app;
 * la app consume esas mismas rutas desde PUBLIC_API_BASE_URL.
 */
const SSR_ONLY_ROUTES = [
  /\/src\/pages\/api\//,
  /\/src\/pages\/admin\//,
  /\/src\/pages\/producto\/\[slug\]\.astro$/,
  /\/src\/pages\/ranking\/\[category\]\.astro$/,
  /\/src\/pages\/comparar\/\[versus\]\.astro$/,
  /\/src\/pages\/sitemap-seo\.xml\.ts$/,
  /\/src\/pages\/reformulaciones\.astro$/,
];
/** Salidas que generan los stubs de las rutas no dinámicas; se borran al terminar el build. */
const SSR_ONLY_OUTPUTS = ['api', 'admin', 'sitemap-seo.xml', 'reformulaciones.html'];

/** @returns {import('astro').AstroIntegration} */
function capacitorTarget() {
  return {
    name: 'sanopasillo:capacitor-target',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'sanopasillo:stub-ssr-routes',
                enforce: 'pre',
                load(id) {
                  const file = (id.split('?')[0] ?? id).replace(/\\/g, '/');
                  if (id.includes('?') || !SSR_ONLY_ROUTES.some((re) => re.test(file))) return null;
                  return file.endsWith('.astro')
                    ? '---\nexport const getStaticPaths = () => [];\n---\n'
                    : 'export const getStaticPaths = () => [];\nexport const GET = () => new Response(null);\n';
                },
              },
            ],
          },
        });
      },
      'astro:build:done': async ({ dir }) => {
        const outDir = fileURLToPath(dir);
        await Promise.all(
          SSR_ONLY_OUTPUTS.map((p) => rm(`${outDir}/${p}`, { recursive: true, force: true })),
        );
      },
    },
  };
}

export default defineConfig({
  site: SITE_URL,
  output: isApp ? 'static' : 'server',
  // Las imágenes vienen de los CDN de los supermercados: no se procesan con sharp.
  adapter: isApp ? undefined : cloudflare({ platformProxy: { enabled: true }, imageService: 'passthrough' }),
  integrations: isApp ? [capacitorTarget()] : [],
  // Capacitor sirve archivos locales: /escanear.html es más fiable que /escanear/index.html.
  build: { format: isApp ? 'file' : 'directory' },
  vite: {
    // @tailwindcss/vite tipa contra Vite 7 y Astro 5 trae Vite 6: solo difieren los tipos.
    plugins: [/** @type {any} */ (tailwindcss())],
    define: {
      'import.meta.env.BUILD_TARGET': JSON.stringify(isApp ? 'capacitor' : 'web'),
    },
  },
});
