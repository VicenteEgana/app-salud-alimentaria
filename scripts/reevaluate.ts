/**
 * Recalcula evaluation_json y los puntajes de todos los productos con el algoritmo actual.
 * Usar después de cambiar reglas o el diccionario de aditivos (sube METHODOLOGY_VERSION).
 * No registra reformulaciones: el trigger de historial solo mira ingredientes y tabla.
 *
 *   npm run db:reevaluate              # D1 local
 *   npm run db:reevaluate -- --remote  # producción
 */
import { writeFileSync } from 'node:fs';
import { buildRow, productToInput, rowToProduct, type ProductRow } from '../src/lib/db';
import { METHODOLOGY_VERSION } from '../src/lib/scorer';
import { d1ApplyFile, d1Query } from './d1';
import { upsertStatement } from './sql';

const remote = process.argv.includes('--remote');
const rows = d1Query<ProductRow>('SELECT * FROM products', remote);
let changed = 0;

const statements = rows.map((row) => {
  const product = rowToProduct(row);
  const next = buildRow(productToInput(product), {
    slug: product.slug,
    verified: product.verified,
    scanConsensusCount: product.scanConsensusCount,
  });
  if (next.final_score !== row.final_score || next.is_fake_healthy !== row.is_fake_healthy) {
    changed++;
    console.log(`${String(row.final_score).padStart(3)} → ${String(next.final_score).padStart(3)}  ${row.slug}`);
  }
  return upsertStatement(next);
});

const file = 'reevaluate.sql';
writeFileSync(file, `-- Re-evaluación con método v${METHODOLOGY_VERSION}\n${statements.join('\n')}\n`);
console.log(`\n${rows.length} productos re-evaluados (${changed} cambian de puntaje o de etiqueta).`);
d1ApplyFile(file, remote);
