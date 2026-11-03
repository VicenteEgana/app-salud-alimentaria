/**
 * Pipeline de ingesta de productos reales chilenos → SQL listo para D1.
 *
 *   # Recorre la búsqueda oficial de Jumbo (40 resultados por página) y lee cada ficha:
 *   npm run ingest -- --query "yoghurt protein" --query "pan de molde" --pages 2
 *   npm run ingest -- --preset trampas --pages 3          # categorías con más "falsos sin sellos"
 *
 *   # EAN puntuales (Open Food Facts + confirmación en Jumbo):
 *   npm run ingest -- 7802920010588 7801234567890
 *
 *   # Opciones: --out ingest.sql  --apply  --remote  --delay 800
 *
 * Con --apply consulta los slugs ya usados en D1 para no chocar con el índice UNIQUE.
 */
import { writeFileSync } from 'node:fs';
import { fetchCatalogProduct, storeProductToCatalog, type CatalogProduct } from '../src/lib/catalog-fetcher';
import { baseSlug, buildRow } from '../src/lib/db';
import { fetchProductPage, searchCatalog } from '../src/lib/stores/cencosud';
import { isValidEan } from '../src/lib/text';
import { d1ApplyFile, d1Query } from './d1';
import { offerStatement, upsertStatement } from './sql';

/** Búsquedas donde abundan los productos "sin sellos" con edulcorantes y aditivos. */
const PRESETS: Record<string, string[]> = {
  trampas: [
    'yoghurt protein',
    'yoghurt',
    'leche cultivada',
    'bebida zero',
    'jugo light',
    'néctar',
    'cereal',
    'barra de cereal',
    'barra proteica',
    'galletas sin azúcar',
    'pan de molde',
    'pechuga de pavo',
    'jamón',
    'vienesas',
    'postre',
    'gelatina',
    'mermelada',
  ],
};

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const options = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));
const option = (name: string) => options(name)[0];

const remote = flag('--remote');
const apply = flag('--apply');
const outFile = option('--out') ?? 'ingest.sql';
const pages = Math.max(1, Number(option('--pages') ?? 1));
const delayMs = Math.max(200, Number(option('--delay') ?? 800));
const queries = [...options('--query'), ...options('--preset').flatMap((p) => PRESETS[p] ?? [])];
const VALUE_OPTIONS = new Set(['--query', '--preset', '--out', '--pages', '--delay']);
const eans = args.filter((a, i) => !a.startsWith('--') && !VALUE_OPTIONS.has(args[i - 1] ?? '') && isValidEan(a));

if (queries.length === 0 && eans.length === 0) {
  console.error('Uso: npm run ingest -- [--query "texto"]… [--preset trampas] [--pages N] [ean…] [--out f.sql] [--apply] [--remote]');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Slugs ya ocupados en D1 (solo si vamos a aplicar el SQL).
const slugOwner = new Map<string, string>();
if (apply) {
  for (const r of d1Query<{ slug: string; ean: string }>('SELECT slug, ean FROM products', remote)) slugOwner.set(r.slug, r.ean);
}

const products = new Map<string, CatalogProduct>();
let skipped = 0;

// --- Búsquedas en Jumbo -------------------------------------------------------
for (const query of queries) {
  for (let page = 0; page < pages; page++) {
    const hits = await searchCatalog('jumbo', query, { from: page * 40, to: page * 40 + 40, timeoutMs: 10000 });
    console.log(`\n🔎 "${query}" página ${page + 1}: ${hits.length} resultados`);
    if (hits.length === 0) break;
    for (const hit of hits) {
      await sleep(delayMs);
      const sp = await fetchProductPage('jumbo', hit.slug, { timeoutMs: 15000 });
      const product = sp ? storeProductToCatalog(sp) : null;
      if (!product) {
        skipped++;
        console.log(`  · ${hit.name}: sin ingredientes o tabla por 100 g`);
        continue;
      }
      if (!products.has(product.ean)) {
        products.set(product.ean, product);
        console.log(`  ✓ ${product.ean} ${product.name}`);
      }
    }
    if (hits.length < 40) break;
  }
}

// --- EAN puntuales ------------------------------------------------------------
for (const ean of eans) {
  const product = await fetchCatalogProduct(ean);
  if (product) {
    products.set(ean, product);
    console.log(`  ✓ ${ean} ${product.name} (${product.sources.join('+')})`);
  } else {
    skipped++;
    console.log(`  ✗ ${ean}: sin datos evaluables`);
  }
  await sleep(delayMs);
}

if (products.size === 0) {
  console.error('\nNingún producto evaluable.');
  process.exit(1);
}

// --- SQL ----------------------------------------------------------------------
const statements: string[] = [];
let fakes = 0;
for (const product of products.values()) {
  let slug = baseSlug(product);
  const owner = slugOwner.get(slug);
  if (owner && owner !== product.ean) slug = `${slug}-${product.ean.slice(-5)}`;
  slugOwner.set(slug, product.ean);

  const row = buildRow(product, { slug, verified: true });
  if (row.is_fake_healthy) fakes++;
  statements.push(upsertStatement(row), ...product.offers.map(offerStatement));
}

writeFileSync(outFile, `-- Generado por scripts/ingest-chile.ts el ${new Date().toISOString()}\n\n${statements.join('\n')}\n`);
console.log(`\n${products.size} productos (${fakes} falsos sin sellos) → ${outFile} · ${skipped} omitidos por datos incompletos`);

if (apply) d1ApplyFile(outFile, remote);
