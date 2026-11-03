/** Minúsculas, sin tildes ni diéresis (la ñ queda como n), espacios colapsados. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Slug URL-safe. Nunca contiene `-vs-`, que está reservado para /comparar/a-vs-b. */
export function slugify(input: string): string {
  return normalizeText(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
    .replace(/-+$/g, '')
    .replace(/(^|-)vs(?=-|$)/g, '$1v');
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 385 → "385", 3.8 → "3.8", 0.25 → "0.3" */
export function formatNumber(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** EAN-8, UPC-A (12), EAN-13 o GTIN-14, con dígito verificador válido. */
export function isValidEan(ean: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(ean)) return false;
  const digits = ean.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
