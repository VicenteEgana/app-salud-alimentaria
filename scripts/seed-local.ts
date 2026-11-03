/**
 * Genera seed.sql evaluando cada producto semilla con evaluateProduct().
 *   npm run db:seed   (genera y aplica en D1 local)
 */
import { writeFileSync } from 'node:fs';
import { baseSlug, buildRow } from '../src/lib/db';
import { SEED_PRODUCTS } from './seed-data';
import { upsertStatement } from './sql';

const statements = SEED_PRODUCTS.map((p) => {
  const row = buildRow({ ...p, dataSource: 'seed' }, { slug: baseSlug(p), verified: true });
  console.log(`${String(row.final_score).padStart(3)}  ${row.is_fake_healthy ? 'FALSO ' : '      '} ${row.slug}`);
  return upsertStatement(row);
});

const header = `-- Generado por scripts/seed-local.ts — no editar a mano.
-- ${SEED_PRODUCTS.length} productos representativos (marcas ficticias, EAN de circulación restringida).
`;
writeFileSync(new URL('../seed.sql', import.meta.url), `${header}\n${statements.join('\n\n')}\n`);
console.log(`\nseed.sql escrito con ${statements.length} productos.`);
