# SanoPasillo

Compara productos de supermercado en Chile por su calidad real: sellos MINSAL (Ley 20.606), ultraprocesamiento (NOVA) y aditivos de riesgo. Desenmascara a los **falsos sin sellos**: 0 sellos, pero llenos de edulcorantes y aditivos industriales.

Web SSR en Cloudflare Pages + D1, y app móvil (Android/iOS) con Capacitor desde el mismo repositorio. La especificación completa (algoritmo, fuentes de datos y funciones v2) está en [CLAUDE.md](CLAUDE.md); el método público, en `/metodologia`.

## Funciones

- **Escáner** de código de barras con cascada D1 → Open Food Facts + Jumbo en vivo → foto de la etiqueta leída con IA (Gemini).
- **Fichas** con puntaje, sellos, casi-sellos, NOVA, aditivos con su evidencia científica, fuente y fecha del dato, precio y botón al carro de Jumbo.
- **Modo niños**: leyenda de edulcorantes propuesta por el MINSAL y % de la ingesta diaria admisible según el peso del niño.
- **Perfiles** (celíaco, sin lactosa, APLV, vegano, diabetes, niños), guardados solo en el dispositivo.
- **Mi lista**: puntaje del carro, alternativas para reemplazar, "Comprar en Jumbo" y alertas cuando un producto cambia su receta.
- **Rankings SEO** por categoría, comparativas A vs B, "más sano y más barato por kilo", página de reformulaciones.
- **Sin conexión**: el escáner funciona en el pasillo con un paquete de productos guardado.
- **Canales**: bot de WhatsApp y API B2B con claves y cuota.
- **Protección**: rate limiting de la IA, Turnstile opcional, derecho a réplica para marcas y panel de moderación.

## Puesta en marcha local

```bash
npm install
cp .dev.vars.example .dev.vars    # agrega GEMINI_API_KEY y ADMIN_SECRET
npm run db:init                   # crea las tablas en D1 local
npm run db:seed                   # 10 productos de ejemplo (marcas ficticias, solo desarrollo)
npm run ingest -- --preset trampas --pages 1 --apply   # productos reales desde Jumbo
npm run dev                       # http://localhost:4321
```

¿Ya tenías una D1 local de la v1? Corre `npm run db:migrate` en vez de `db:init`.

Sin `GEMINI_API_KEY`, todo funciona salvo la lectura de etiquetas por foto (`/api/analyze-label` responde 503).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm test` | Tests (algoritmo, parser de Jumbo, perfiles, edulcorantes, historial, WhatsApp) |
| `npm run check` | Chequeo de tipos (`astro check`) |
| `npm run build` | Build web SSR para Cloudflare Pages |
| `npm run build:app` | Build estático para Capacitor (`BUILD_TARGET=capacitor`) |
| `npm run cap:sync` | `build:app` + `cap sync` (requiere `npx cap add android` / `ios` una vez) |
| `npm run ingest -- --query "texto" --pages N --apply` | Recorre la búsqueda de Jumbo y guarda productos y precios |
| `npm run ingest -- <ean…>` | EAN puntuales (Open Food Facts + confirmación en Jumbo) |
| `npm run db:reevaluate` | Recalcula todos los puntajes tras cambiar el método (`-- --remote` en producción) |
| `npm run api-key -- --client "Nombre"` | Crea una clave para la API B2B (se muestra una sola vez) |

## Despliegue en Cloudflare

```bash
npx wrangler d1 create sanopasillo-db          # copia el database_id a wrangler.toml
npx wrangler d1 execute sanopasillo-db --remote --file=./schema.sql
npx wrangler pages secret put GEMINI_API_KEY
npx wrangler pages secret put ADMIN_SECRET
npm run build && npx wrangler pages deploy ./dist
npm run ingest -- --preset trampas --pages 2 --apply --remote
```

Opcionales: `TURNSTILE_SECRET_KEY` (+ `PUBLIC_TURNSTILE_SITE_KEY` en el build), límites `ANALYZE_LIMIT_*` y las variables `WHATSAPP_*` (ver `.dev.vars.example`). El webhook de WhatsApp es `https://<dominio>/api/whatsapp`.

## App móvil

La app empaqueta las páginas que no dependen de la base (inicio, escáner, lista, perfil, metodología, reportar, empresas) y consume la API de producción en `PUBLIC_API_BASE_URL` (por defecto `https://sanopasillo.cl`). Las fichas, rankings y comparativas se abren en la web.

```bash
PUBLIC_API_BASE_URL=https://sanopasillo.cl npm run cap:sync
npx cap open android
```

## Datos

- `seed.sql`: 10 productos **representativos** con marcas ficticias y EAN de circulación restringida (prefijo 200). Solo para desarrollo; no aplicarlo en producción.
- Productos reales: `npm run ingest` (fichas de Jumbo: etiqueta chilena, precio, porción, condiciones alimentarias) o escaneo + moderación en `/admin/pendientes`.
- Cada ficha registra su fuente (`data_source`) y fecha; los cambios de receta quedan en `product_history`.
