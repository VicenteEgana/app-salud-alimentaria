/** Describe en lenguaje simple qué cambió entre dos versiones de un producto (reformulaciones). */
import type { HistoryEntry } from './db';
import type { Nutrients, ProductEvaluation } from './scorer';
import { formatNumber, normalizeText } from './text';

const NUTRIENT_LABELS: Record<keyof Nutrients, { label: string; unit: string }> = {
  calories: { label: 'Calorías', unit: 'kcal' },
  sugars: { label: 'Azúcares', unit: 'g' },
  saturatedFat: { label: 'Grasas saturadas', unit: 'g' },
  sodium: { label: 'Sodio', unit: 'mg' },
  protein: { label: 'Proteínas', unit: 'g' },
  fiber: { label: 'Fibra', unit: 'g' },
};

/** Diferencias menores a esto se consideran redondeo de la etiqueta, no reformulación. */
const NUTRIENT_TOLERANCE = 0.05;

export interface ChangeLine {
  kind: 'worse' | 'better' | 'neutral';
  text: string;
}

function additiveChanges(oldEv: ProductEvaluation | null, newEv: ProductEvaluation | null): ChangeLine[] {
  const before = new Map((oldEv?.additives ?? []).map((a) => [a.id, a.name]));
  const after = new Map((newEv?.additives ?? []).map((a) => [a.id, a.name]));
  return [
    ...[...after].filter(([id]) => !before.has(id)).map(([, name]): ChangeLine => ({ kind: 'worse', text: `Agregó ${name}` })),
    ...[...before].filter(([id]) => !after.has(id)).map(([, name]): ChangeLine => ({ kind: 'better', text: `Quitó ${name}` })),
  ];
}

function sealChanges(oldEv: ProductEvaluation | null, newEv: ProductEvaluation | null): ChangeLine[] {
  const before = new Set(oldEv?.minsalSeals ?? []);
  const after = new Set(newEv?.minsalSeals ?? []);
  return [
    ...[...after].filter((s) => !before.has(s)).map((s): ChangeLine => ({ kind: 'worse', text: `Nuevo sello ${s}` })),
    ...[...before].filter((s) => !after.has(s)).map((s): ChangeLine => ({ kind: 'better', text: `Perdió el sello ${s}` })),
  ];
}

function nutrientChanges(oldN: Nutrients | null, newN: Nutrients | null): ChangeLine[] {
  if (!oldN || !newN) return [];
  return (Object.keys(NUTRIENT_LABELS) as (keyof Nutrients)[]).flatMap((key): ChangeLine[] => {
    const a = oldN[key];
    const b = newN[key];
    const max = Math.max(Math.abs(a), Math.abs(b));
    if (max === 0 || Math.abs(a - b) <= NUTRIENT_TOLERANCE * max) return [];
    const { label, unit } = NUTRIENT_LABELS[key];
    const higherIsBetter = key === 'protein' || key === 'fiber';
    const kind = b > a === higherIsBetter ? 'better' : 'worse';
    return [{ kind, text: `${label}: ${formatNumber(a)} → ${formatNumber(b)} ${unit}` }];
  });
}

/** Líneas de cambio de una entrada del historial. Vacío si solo cambió el formato del texto. */
export function describeChange(entry: HistoryEntry): ChangeLine[] {
  const lines = [
    ...sealChanges(entry.oldEvaluation, entry.newEvaluation),
    ...additiveChanges(entry.oldEvaluation, entry.newEvaluation),
    ...nutrientChanges(entry.oldNutrients, entry.newNutrients),
  ];
  const ingredientsChanged =
    normalizeText(entry.oldIngredients ?? '').replace(/[^a-z0-9]/g, '') !==
    normalizeText(entry.newIngredients ?? '').replace(/[^a-z0-9]/g, '');
  if (lines.length === 0 && ingredientsChanged) lines.push({ kind: 'neutral', text: 'Cambió la lista de ingredientes' });
  return lines;
}
