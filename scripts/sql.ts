/** Genera SQL literal (para `wrangler d1 execute --file`, que no admite parámetros). */
import { OFFER_UPSERT_SQL, offerValues, rowValues, upsertSql, type NewProductRow, type Offer } from '../src/lib/db';

export function sqlLiteral(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

function inline(template: string, values: (string | number | null)[]): string {
  let i = 0;
  return `${template.replace(/\?/g, () => sqlLiteral(values[i++] ?? null))};`;
}

export const upsertStatement = (row: NewProductRow) => inline(upsertSql(), rowValues(row));
export const offerStatement = (offer: Omit<Offer, 'updatedAt'>) => inline(OFFER_UPSERT_SQL, offerValues(offer));
