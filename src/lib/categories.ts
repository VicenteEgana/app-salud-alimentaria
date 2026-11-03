import { normalizeText, slugify } from './text';

export interface Category {
  slug: string;
  name: string;
  /** Plural para títulos SEO: "Los yogures más sanos de Chile" */
  seoNoun: string;
  /** Título del ranking con artículo y concordancia: "Las cecinas … más sanas". */
  seoHeadline: string;
  /** Palabras (normalizadas) que identifican la categoría en nombres/categorías de VTEX u OFF. */
  keywords: RegExp;
}

export const CATEGORIES: Category[] = [
  {
    slug: 'yogures-y-lacteos',
    name: 'Yogures y lácteos',
    seoNoun: 'yogures y lácteos',
    seoHeadline: 'Los yogures y lácteos más sanos',
    keywords: /\b(yogur|yoghurt|yogurt|leche|lacteo|kefir|quesillo|queso)/,
  },
  {
    slug: 'panes-de-molde',
    name: 'Panes de molde',
    seoNoun: 'panes de molde',
    seoHeadline: 'Los panes de molde más sanos',
    keywords: /\b(pan(es)? de molde|pan molde|pan integral|pan blanco|pan de sandwich|pan sandwich|bread)\b/,
  },
  {
    slug: 'cecinas-y-pavo',
    name: 'Cecinas y pavo',
    seoNoun: 'cecinas y pechugas de pavo',
    seoHeadline: 'Las cecinas y pechugas de pavo más sanas',
    keywords: /\b(cecina|fiambre|jamon|pavo|pechuga|salame|vienesa|longaniza|mortadela|salchicha|chorizo)/,
  },
];

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

/** Nombre legible de cualquier slug, conocido o no. */
export function categoryName(slug: string): string {
  const known = getCategory(slug);
  if (known) return known.name;
  const words = slug.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Asigna una categoría a partir de textos libres, revisándolos en orden: primero el nombre del producto,
 * luego las categorías de la más específica a la más general ("Pechuga de Pavo y Pollo" antes que
 * "Quesos y Fiambres"). Si nada calza, deriva un slug de la categoría de respaldo.
 */
export function guessCategorySlug(name: string, categoryTexts: string[], fallbackCategory?: string): string {
  // "Pan de leche" es pan y "Pechuga de pavo con queso" es cecina: las palabras más específicas van primero.
  const byPriority = ['panes-de-molde', 'cecinas-y-pavo', 'yogures-y-lacteos'].map((slug) => getCategory(slug)!);
  for (const text of [name, ...[...categoryTexts].reverse()]) {
    const normalized = normalizeText(text);
    const match = byPriority.find((c) => c.keywords.test(normalized));
    if (match) return match.slug;
  }
  const fallback = fallbackCategory ? slugify(fallbackCategory) : '';
  return fallback || 'otros';
}
