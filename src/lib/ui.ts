/** Clases y textos de presentación compartidos por componentes Astro y render en cliente. */
import { scoreTier, type AdditiveLevel, type NovaGroup, type ScoreTier } from './scorer';

export const TIER_STYLES: Record<ScoreTier, { color: string; text: string; soft: string; label: string }> = {
  // Etiquetas descriptivas del puntaje, no recomendaciones de consumo (ver /metodologia).
  good: { color: '#039855', text: 'text-emerald-700', soft: 'bg-emerald-50 border-emerald-200', label: 'Puntaje alto' },
  medium: { color: '#f59e0b', text: 'text-amber-700', soft: 'bg-amber-50 border-amber-200', label: 'Puntaje medio' },
  bad: { color: '#dc2626', text: 'text-red-700', soft: 'bg-red-50 border-red-200', label: 'Puntaje bajo' },
};

/** "$3.217" */
export const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

/** "$3.217/kg" */
export const perUnit = (price: number | null, unit: string | null) =>
  price ? `${clp(price)}/${unit === 'lt' ? 'L' : (unit ?? 'kg')}` : '';

/** "2026-11-03 18:47:29" (UTC de SQLite) → "3 nov 2026" */
export function formatDate(sqlite: string): string {
  const d = new Date(`${sqlite.replace(' ', 'T')}${sqlite.includes('Z') ? '' : 'Z'}`);
  return Number.isNaN(d.getTime()) ? sqlite : d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const tierStyle = (score: number) => TIER_STYLES[scoreTier(score)];

export const NOVA_BADGE: Record<NovaGroup, string> = {
  1: 'bg-emerald-100 text-emerald-800',
  2: 'bg-lime-100 text-lime-800',
  3: 'bg-amber-100 text-amber-800',
  4: 'bg-red-100 text-red-800',
};

export const ADDITIVE_LEVEL_STYLE: Record<AdditiveLevel, string> = {
  3: 'border-red-300 bg-red-50 text-red-900',
  2: 'border-orange-300 bg-orange-50 text-orange-900',
  1: 'border-violet-300 bg-violet-50 text-violet-900',
};

/** "ALTO EN GRASAS SATURADAS" → "GRASAS SATURADAS" para el octágono. */
export const sealNutrient = (seal: string) => seal.replace(/^ALTO EN\s+/, '');
