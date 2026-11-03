/** URLs canónicas de /comparar: slugs en orden alfabético, unidos por -vs-. */
export const VERSUS_SEPARATOR = '-vs-';

export function canonicalPair(slugA: string, slugB: string): [string, string] {
  return [slugA, slugB].sort((a, b) => a.localeCompare(b)) as [string, string];
}

export function versusPath(slugA: string, slugB: string): string {
  const [a, b] = canonicalPair(slugA, slugB);
  return `/comparar/${a}${VERSUS_SEPARATOR}${b}`;
}

/** Todos los pares posibles de una lista (para el sitemap). */
export function allPairs<T>(items: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) pairs.push([items[i]!, items[j]!]);
  }
  return pairs;
}
