# SanoPasillo — Especificación técnica

Plataforma web + app móvil para el mercado chileno que compara productos de supermercado según su calidad nutricional real, su nivel de ultraprocesamiento (escala NOVA) y el riesgo de sus aditivos. Desenmascara a los "Falsos Saludables": productos con 0 sellos negros MINSAL pero llenos de edulcorantes artificiales, espesantes e ingredientes industriales.

El nombre "SanoPasillo" es configurable (`src/lib/site.ts`).

## Comandos

```bash
npm run dev            # Astro dev con platformProxy (D1 local de Wrangler)
npm test               # Tests del algoritmo (vitest)
npm run check          # astro check (tipos)
npm run build          # Build web SSR para Cloudflare Pages
npm run build:app      # Build estático para Capacitor (BUILD_TARGET=capacitor)
npm run db:init        # Aplica schema.sql en D1 local (instalación nueva)
npm run db:migrate     # Actualiza una D1 local creada con la v1 (migrations/0002_mejoras.sql)
npm run db:seed        # Regenera seed.sql desde scripts/seed-data.ts y lo aplica en D1 local
npm run db:reevaluate  # Recalcula todos los puntajes con el algoritmo actual (-- --remote para producción)
npm run ingest -- --preset trampas --pages 2 --apply   # Productos reales desde Jumbo → D1
npm run ingest -- <ean...>                             # EAN puntuales (OFF + Jumbo)
npm run api-key -- --client "Nombre"                   # Clave para la API B2B
```

Secretos locales en `.dev.vars` (no se versiona): `GEMINI_API_KEY`, `ADMIN_SECRET` y opcionales (ver `.dev.vars.example`).

---

## 1. Stack y arquitectura híbrida (Web SSR + App Capacitor)

- **Framework:** Astro 5 + TypeScript estricto + Tailwind CSS (v4 vía `@tailwindcss/vite`).
- **Backend y BD:** Cloudflare Pages Functions (SSR) + Cloudflare D1 (binding `DB`).
- **Móvil:** Capacitor (`@capacitor/core`, `@capacitor/camera`, `@capacitor/haptics`) + `html5-qrcode` para EAN-13 / EAN-8.
- **Visión IA:** API REST de Gemini 2.5 Flash (`gemini-2.5-flash`) con Structured Outputs (`response_mime_type: "application/json"`).
- **Compilación dual (`astro.config.mjs`):**
  - `BUILD_TARGET=capacitor` → `output: 'static'`, sin adaptador. Las rutas SSR puras (API, admin, sitemap, páginas dinámicas por slug) se excluyen del build y el cliente consume la API de producción en `PUBLIC_API_BASE_URL` (ej. `https://sanopasillo.cl`).
  - Por defecto (web) → `output: 'server'` con `@astrojs/cloudflare` y `platformProxy: { enabled: true }`.

## 2. Estructura

```text
├── schema.sql                 # Esquema D1 + índices
├── seed.sql                   # 10 productos chilenos pre-calculados (generado por scripts/seed-local.ts)
├── wrangler.toml              # Cloudflare Pages + binding D1 (DB)
├── capacitor.config.ts        # Capacitor apuntando a ./dist
├── scripts/
│   ├── ingest-chile.ts        # Pipeline CLI: VTEX (Jumbo/Santa Isabel) + Open Food Facts Chile
│   ├── seed-data.ts           # Datos crudos de los 10 productos semilla
│   └── seed-local.ts          # Evalúa con evaluateProduct() y escribe seed.sql
├── src/
│   ├── env.d.ts               # Tipos de Cloudflare Runtime Env (DB, GEMINI_API_KEY, ADMIN_SECRET)
│   ├── layouts/MainLayout.astro
│   ├── lib/
│   │   ├── scorer.ts          # Algoritmo chileno (Nutrición + NOVA + Aditivos + Hard Caps)
│   │   ├── catalog-fetcher.ts # Extractores VTEX Cencosud + Open Food Facts Chile
│   │   ├── db.ts              # Acceso a D1 (filas ↔ objetos)
│   │   └── ...
│   ├── components/
│   │   ├── VersusComparator.astro
│   │   ├── SmartScanner.astro
│   │   └── ProductCard.astro
│   └── pages/
│       ├── index.astro, escanear.astro
│       ├── producto/[slug].astro
│       ├── ranking/[category].astro
│       ├── comparar/[versus].astro
│       ├── admin/pendientes.astro
│       ├── sitemap-seo.xml.ts
│       └── api/product/[ean].ts, api/analyze-label.ts, api/admin/moderate.ts
```

## 3. Esquema D1

Ver `schema.sql`. Tabla única `products` (PK `ean`, `slug` único). Columnas JSON: `nutrients_json` (`{ calories, sugars, saturatedFat, sodium, protein, fiber }`) y `evaluation_json` (resultado completo de `evaluateProduct()`). `verified = 0` → escaneado por usuario (pendiente); `verified = 1` → verificado e indexable.

## 4. Reglas del algoritmo chileno (`src/lib/scorer.ts`)

Función pura `evaluateProduct(product: RawProductInput): ProductEvaluation`.

### A. Ponderación

`Score Base = Math.round(nutritionScore * 0.50 + novaScore * 0.20 + additivesScore * 0.30)`

### B. Pilar 1 — Calidad nutricional (0–100, parte en 50)

Siempre por 100 g (sólidos) o 100 ml (líquidos), límites Fase 3 Ley 20.606:

| | Calorías | Azúcares | Grasas sat. | Sodio |
|---|---|---|---|---|
| Sólidos (100 g) | 275 kcal | 10 g | 4 g | 400 mg |
| Líquidos (100 ml) | 70 kcal | 5 g | 3 g | 100 mg |

- **Sellos:** si un nutriente supera el límite (azúcares: solo si hay marcador de azúcar añadido) → `ALTO EN AZÚCARES`, `ALTO EN GRASAS SATURADAS`, `ALTO EN SODIO`, `ALTO EN CALORÍAS`.
- **Casi sello (`borderlineWarnings`):** entre 90 % y 99.9 % del límite → ej. `"Sodio al límite legal (385mg / 400mg)"`.
- **Excepciones:**
  1. Alimento entero de 1 ingrediente (NOVA 1 o 2): calorías y grasas saturadas intrínsecas NO restan puntos.
  2. Lactosa intrínseca: si `categorySlug` incluye `lacteo` o `yogur` y no hay marcadores de azúcar añadido (`azúcar, sacarosa, jarabe, miel, fructosa, dextrosa, maltodextrina, glucosa, concentrado de jugo`), se descuentan los primeros 4.8 g de azúcar antes de penalizar.
- **Descuentos:** hasta −20 por azúcar, −15 por grasa saturada, −15 por sodio (proporcionales al límite).
- **Bonificaciones:** proteína hasta +20 (`(protein / 2) * 5`), fibra hasta +15 (`(fiber / 1.5) * 8`), +15 si NOVA 1–3. Resultado acotado a 0–100.

### C. Pilar 2 — NOVA (20 %)

Texto normalizado (minúsculas, sin tildes).

- **NOVA 4 (0 pts):** > 7 ingredientes, cualquier aditivo del diccionario, o marcador industrial: `/\b(maltodextrina|almidon\s+modificado|jarabe\s+de\s+glucosa|dextrosa|proteina\s+aislada\s+de\s+soya|suero\s+de\s+leche\s+en\s+polvo|aceite\s+vegetal\s+(hidrogenado|interesterificado|fraccionado)|saborizante\s+(identico\s+al\s+natural|artificial)|aroma\s+artificial|mono\s+y\s+digliceridos|polidextrosa|inulina)\b/i`
- **NOVA 3 (50):** 3–7 ingredientes sin marcadores industriales.
- **NOVA 2 (80):** 2 ingredientes simples.
- **NOVA 1 (100):** 1 ingrediente natural sin aditivos.

### D. Pilar 3 — Aditivos (30 %, parte en 100)

Detecta nombres en español y códigos `SIN` / `INS` / `E`.

1. **Nivel 3 — Crítico (−45 c/u):** nitrito/nitrato de sodio o potasio (SIN 249–252), tartrazina (102), amarillo crepúsculo (110), rojo allura (129), BHA/BHT (320/321), JMAF.
2. **Nivel 2 — Moderado (−20 c/u):** carragenina (407), CMC (466), polisorbatos (432–436), polifosfatos/trifosfatos/fosfato trisódico (450–452), glutamato monosódico (621).
3. **Nivel 1 — Edulcorantes:** sucralosa (955), acesulfamo K (950), aspartamo (951), ciclamato (952): −15 c/u. Stevia (960) o alulosa: −5.
   - **Mezcla:** ≥ 2 edulcorantes Nivel 1 → −10 extra y `multiSweetenerPenalty: true`.

### E. Hard caps e `isFakeHealthy`

1. ≥ 1 aditivo Nivel 3 → `finalScore ≤ 49` (`hardCapReason: "Puntaje bloqueado en 49 por contener aditivos de riesgo crítico"`).
2. `minsalSeals.length >= 3` → `finalScore ≤ 35`.
3. `isFakeHealthy = minsalSeals.length === 0 && novaGroup === 4 && (edulcorante Nivel 1 || aditivo Nivel 2/3)`.

## 5. Cascada de datos

1. **`GET /api/product/[ean]`:** D1 → VTEX Jumbo (`https://www.jumbo.cl/api/catalog_system/pub/products/search/${ean}`) → Open Food Facts Chile (`https://cl.openfoodfacts.org/api/v2/product/${ean}.json`). Si lo encuentra en vivo: `evaluateProduct()`, insert con `verified = 1`, devuelve JSON. Si no: 404.
2. **`POST /api/analyze-label`:** `{ ean, productNameHint, imageBase64 }` → Gemini 2.5 Flash extrae ingredientes y la columna 100 g/100 ml (ignora "1 porción", sodio g → mg).
   - **Anti-alucinación:** 422 si `isValidLabel === false`, si `sugars + saturatedFat + protein + fiber > 102`, o si `calories > 905`.
   - Guarda con `verified = 0`. Si ya existía un registro `verified = 0` para ese EAN y calorías/azúcares coinciden ±5 % → `verified = 1` (consenso).

## 6. SEO programático, UI y moderación

1. **`VersusComparator.astro`:** cabecera `sticky top-0 z-20 grid grid-cols-2` con nombres y círculos de puntaje (verde ≥ 75, ámbar 50–74, rojo < 50); badges de sellos y NOVA; tarjetas de aditivos por nivel; tabla por 100 g con `✓` verde al ganador de cada fila.
2. **`/comparar/[versus]`:** separa por `-vs-`, ordena alfabéticamente (`localeCompare`); si no está en orden canónico → 301.
3. **`/ranking/[category]`:** bloques "Top Más Saludables" (`final_score >= 65`) y "La Trampa del Pasillo: Falsos Sin Sellos" (`is_fake_healthy = 1`); JSON-LD `ItemList` + `FAQPage`; `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800`.
4. **`/admin/pendientes` + `POST /api/admin/moderate`:** lista `verified = 0`, edición inline de name, brand, categorySlug, ingredientsRaw y 6 nutrientes; header `x-admin-secret`; al aprobar recalcula, genera slug definitivo y pone `verified = 1`.

## 7. Seed

10 productos chilenos en `yogures-y-lacteos`, `panes-de-molde`, `cecinas-y-pavo`, con opciones naturales y "Falsos Sin Sellos". `seed.sql` se genera con `scripts/seed-local.ts` usando `evaluateProduct()` — no editar `seed.sql` a mano.

---

## 8. Versión 2 del producto (método v2.0)

Cambios sobre la especificación original. `METHODOLOGY_VERSION` en `src/lib/scorer.ts` se muestra en `/metodologia` y en la API B2B; subirla al cambiar reglas y correr `npm run db:reevaluate`.

### Datos
- **El endpoint VTEX `catalog_system` de Jumbo/Santa Isabel ya no existe** (su frontend es Next.js). Fuente actual (`src/lib/stores/cencosud.ts`):
  - Búsqueda: `POST {origin}/api/catalog` (API pública documentada en `{origin}/openapi.json`). No acepta EAN.
  - Ficha: `GET {origin}/{slug}/p` → payload RSC con `items[].ean`, `specifications` (ingredientes, porción, `alimentaryConditions`) y tabla `"100 g / porción"`.
  - Carro: `{origin}/?sku=a,b&qty=1,2`.
- Cascada en vivo (`src/lib/lookup.ts`): D1 → Open Food Facts por EAN (da el nombre) → búsqueda en Jumbo por nombre → se confirma el EAN en la ficha. La tabla nutricional se toma completa de **una sola** fuente (prioridad: ficha chilena).
- Ingesta masiva: `scripts/ingest-chile.ts` recorre la búsqueda de Jumbo por términos (`--query`, `--preset trampas`).
- Columnas nuevas en `products`: `data_source`, `portion_text`, `portion_size`, `dietary_tags`. Tablas nuevas: `offers`, `product_history` (+ trigger), `reports`, `rate_limits`, `api_keys`.
- `seed.sql` es solo para desarrollo local (marcas ficticias); no aplicarlo en producción.

### Algoritmo
- Aditivos nuevos: dióxido de titanio (N3, −45), caramelo amónico 150c/d (N2, −20), benzoatos 210-213 (N2, −20), sacarina 954 (N1, −15), polioles (maltitol, sorbitol, eritritol, xilitol, isomalt…; N1, −10, cuentan para la mezcla de edulcorantes).
- Cada aditivo tiene `sources` (EFSA, IARC/OMS, JECFA, estudios); se muestran en la ficha y en `/metodologia`. No se guardan en `evaluation_json`.
- `evaluation.sweeteners`: mg declarados por 100 g/ml o por porción (`src/lib/sweeteners.ts`), para el **modo niños** (% de IDA JECFA según peso).
- `evaluation.kidsSweetenerWarning`: aplicaría la leyenda MINSAL propuesta "Contiene edulcorantes. Evite consumo en niños" (art. 120 ter, en trámite). No afecta el puntaje.
- La declaración "Contiene X mg de …" no cuenta como ingrediente.
- Categoría: se revisa el nombre y luego la categoría más específica (`guessCategorySlug`).

### Lenguaje y defensa legal
- Etiquetas de puntaje descriptivas: "Puntaje alto / medio / bajo" (no "Evitar").
- Cada ficha muestra fuente y fecha del dato, enlaza la metodología y ofrece "Reportar un error" y "¿Eres la marca? Solicita revisión" (`/reportar`, guarda en `reports`, visible solo con `x-admin-secret`).
- Política de independencia: las marcas no pagan por puntaje (footer, `/metodologia`, `/empresas`).

### Funciones de usuario
- **Perfiles** (`src/lib/profiles.ts`): celíaco, sin lactosa, APLV, vegano, diabetes, niños. Se evalúan y guardan **solo en el dispositivo** (datos de salud, Ley 21.719). Estados `ok | revisar | alerta`, nunca "apto".
- **Mi lista** (`/lista`): en localStorage; puntaje del carro, alternativas para reemplazar, botón "Comprar en Jumbo" con todos los SKU, alertas de reformulación (`/api/changes`).
- **Sin conexión**: `/api/offline-pack` (resumen de hasta 3000 verificados) se guarda en el dispositivo cada 7 días; el escáner lo usa si falla la red.
- **Reformulaciones**: trigger `trg_products_history` registra cambios de ingredientes/tabla en productos verificados con la misma fuente; `describeChange` los traduce. Páginas: historial en la ficha y `/reformulaciones`.
- **Precio**: `offers` por tienda; ficha "Dónde comprar", ranking "Más sano y más barato por kilo", precio en tarjetas.

### Canales y protección
- **Rate limiting** en D1 (`src/lib/rate-limit.ts`, IP con hash): `/api/analyze-label` 10/h por IP con Turnstile, 3/h sin, 500/día global; `/api/report` 5/h; WhatsApp 30 mensajes/h y 5 lecturas IA/h por teléfono.
- **Turnstile** opcional (`PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`), solo en la web.
- **API B2B** `/api/v1/products/{ean}` y `/api/v1/categories/{slug}` con `x-api-key` (hash SHA-256 en `api_keys`, cuota mensual). Forma pública en `src/lib/b2b.ts`.
- **WhatsApp** `/api/whatsapp` (Cloud API de Meta): verifica `X-Hub-Signature-256`, responde EAN/nombre y lee fotos con el EAN en la descripción; procesa con `waitUntil`.

### Catálogo y comparador
- **`GET /api/products/search`** (`q`, `category`, `filter` = `top,fake_healthy,real_food,no_seals` combinables, `sort` = `score_desc|score_asc|additives`, `limit` ≤ 60, `offset`): arreglo de `ProductSummary` (`src/lib/catalog.ts`) y total en el header `X-Total-Count` (expuesto por CORS). Cada palabra de `q` se busca sin tildes en "nombre marca"; 8–14 dígitos también buscan el EAN exacto (`catalogWhere` en `db.ts`).
- **`/productos`** (`ProductCatalog.astro`): buscador con debounce de 250 ms, categoría, filtros rápidos, orden y "Cargar más". El estado vive en la URL; con filtros la página es `noindex` y canónica a `/productos`.
- **Tarjeta única**: `productCardHtml` (`src/lib/product-html.ts`) la usan `ProductCard.astro` (SSR) y el navegador. El nombre enlaza a la ficha y cubre la tarjeta; el botón `+ Comparar` (`data-compare-product` con JSON) queda encima.
- **Barra de comparación** (`ComparisonDock.astro`, en `MainLayout`): cola de hasta 2 productos en localStorage `sanopasillo_compare_queue` + evento `sanopasillo:compare-change` (`src/lib/compare.ts`). Con la cola llena, el nuevo reemplaza al segundo. Escucha los clics de cualquier `[data-compare-product]` (catálogo, rankings, ficha, escáner) y sincroniza los botones nuevos con un MutationObserver. Se apaga con `compareDock={false}` (en `/comparar` y en el versus).
- **`/comparar`** (`InteractiveSelector.astro`): selectores A/B con el combobox de `src/lib/product-picker.ts` (sin texto sugiere la categoría del otro producto); al elegir ambos navega a `/comparar/a-vs-b`. "Comparativas populares": `getVersusSuggestions` + `pairSuggestions` (mejor de cada categoría vs. su falso sin sellos de peor puntaje).
- **Versus**: botón "🔄 Cambiar" en cada columna de la cabecera fija para reemplazar ese producto y saltar al nuevo versus canónico.

### App (Capacitor)
Páginas empaquetadas: `/`, `/escanear`, `/lista`, `/perfil`, `/metodologia`, `/reportar`, `/empresas`, `/productos`, `/comparar` (`STATIC_PAGES` en `src/lib/site.ts`). `/productos` y `/comparar` leen D1 en la web y, en la app, piden los datos a la API desde el navegador (`src/lib/catalog-client.ts`). `/reformulaciones` es SSR-only. Para probar la app en local: `PUBLIC_API_BASE_URL=http://localhost:4321 npm run build:app` y la configuración `sanopasillo-app-preview` de `.claude/launch.json` (puerto 4322).
