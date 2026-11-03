/**
 * Edulcorantes: cantidad declarada en la etiqueta e ingesta diaria admisible (IDA).
 *
 * En Chile el Reglamento Sanitario de los Alimentos exige declarar la cantidad de edulcorante
 * ("Contiene 12 mg de sucralosa por 100 ml"). Con eso y el peso del niño se estima qué parte de la IDA
 * cubre una porción. IDA de JECFA (FAO/OMS), que es la referencia del Codex que sigue el RSA.
 */

export interface SweetenerAmount {
  additiveId: string;
  /** mg por 100 g / 100 ml, si la etiqueta lo declara así. */
  mgPer100: number | null;
  /** mg por porción, si la etiqueta lo declara así. */
  mgPerPortion: number | null;
}

export interface AdiReference {
  /** mg por kg de peso corporal por día */
  mgPerKg: number;
  note?: string;
}

/** IDA JECFA en mg/kg pc/día. Los polioles y la alulosa no tienen IDA numérica ("no especificada"). */
export const SWEETENER_ADI: Record<string, AdiReference> = {
  sucralosa: { mgPerKg: 15 },
  'acesulfamo-k': { mgPerKg: 15 },
  aspartamo: { mgPerKg: 40 },
  ciclamato: { mgPerKg: 11, note: 'expresada como ácido ciclámico' },
  sacarina: { mgPerKg: 5 },
  stevia: { mgPerKg: 4, note: 'expresada como esteviol; la etiqueta suele declarar glicósidos, así que es una estimación conservadora' },
};

/** Edulcorantes a los que aplicaría la leyenda propuesta por el MINSAL (art. 120 ter, en trámite). */
export const KIDS_WARNING_SWEETENERS = new Set(['sucralosa', 'acesulfamo-k', 'aspartamo', 'ciclamato', 'sacarina', 'stevia']);

export const KIDS_WARNING_TEXT = 'Contiene edulcorantes. Evite consumo en niños';

/** Nombres (normalizados) con que aparece cada edulcorante junto a su cantidad. */
const NAME_PATTERNS: Record<string, string> = {
  sucralosa: 'sucralosa',
  'acesulfamo-k': 'acesulfam[oe]?(?:\\s*(?:k|de\\s+potasio|potasico))?',
  aspartamo: 'aspartam[oe]',
  ciclamato: 'ciclamat[oe]s?(?:\\s+de\\s+sodio)?',
  sacarina: 'sacarina(?:\\s+(?:sodica|de\\s+sodio))?',
  stevia: '(?:stevia|estevia|glicosidos?\\s+de\\s+esteviol|glucosidos?\\s+de\\s+esteviol|rebaudiosido\\s*a?)',
};

const NUM = '(\\d+(?:[.,]\\d+)?)';
const BASIS = '(?:por|/|en|cada)\\s*(?:cada\\s+)?(100\\s*(?:g|gr|grs|gramos|ml|cc|mililitros)|porcion(?:\\s+de\\s+\\d+\\s*(?:g|ml))?)';

const toNumber = (s: string) => Number.parseFloat(s.replace(',', '.'));

/**
 * Busca declaraciones como "contiene 12 mg de sucralosa por 100 ml", "sucralosa 15 mg/100 g"
 * o "aspartamo (45 mg por porción)" en el texto normalizado de ingredientes.
 */
export function parseSweetenerAmounts(normalizedText: string, sweetenerIds: string[]): SweetenerAmount[] {
  // Declaraciones con varias cantidades y una sola base:
  // "contiene 18 mg de sucralosa y 12 mg de acesulfamo k por 100 g".
  const sharedBasis = [...normalizedText.matchAll(new RegExp(`((?:${NUM}\\s*mg[^.;]*?)+)${BASIS}`, 'g'))].map((m) => ({
    segment: m[1]!,
    per100: m[m.length - 1]!.startsWith('100'),
  }));

  return sweetenerIds.flatMap((id) => {
    const name = NAME_PATTERNS[id];
    if (!name) return [];
    const amount: SweetenerAmount = { additiveId: id, mgPer100: null, mgPerPortion: null };
    const assign = (raw: string, per100: boolean) => {
      const value = toNumber(raw);
      if (!Number.isFinite(value)) return;
      if (per100) amount.mgPer100 ??= value;
      else amount.mgPerPortion ??= value;
    };

    for (const { segment, per100 } of sharedBasis) {
      for (const m of segment.matchAll(new RegExp(`${NUM}\\s*mg\\s*(?:de\\s+)?${name}`, 'g'))) assign(m[1]!, per100);
    }
    // "sucralosa 15 mg/porción", "aspartamo (45 mg por 100 ml)"
    for (const m of normalizedText.matchAll(new RegExp(`${name}\\s*[:(]?\\s*${NUM}\\s*mg\\s*${BASIS}`, 'g'))) {
      assign(m[1]!, m[2]!.startsWith('100'));
    }
    return [amount];
  });
}

export interface ExposureEstimate {
  additiveId: string;
  mgConsumed: number;
  adiMg: number;
  /** Porcentaje de la IDA diaria del niño (0–∞). */
  percentOfAdi: number;
}

/**
 * Exposición estimada para `grams` gramos/ml consumidos por una persona de `weightKg`.
 * Usa mg/100 si está declarado; si no, mg/porción escalado por el tamaño de porción.
 */
export function estimateExposure(
  amount: SweetenerAmount,
  grams: number,
  weightKg: number,
  portionSize: number | null,
): ExposureEstimate | null {
  const adi = SWEETENER_ADI[amount.additiveId];
  if (!adi || weightKg <= 0 || grams <= 0) return null;
  let mg: number | null = null;
  if (amount.mgPer100 !== null) mg = (amount.mgPer100 * grams) / 100;
  else if (amount.mgPerPortion !== null && portionSize) mg = (amount.mgPerPortion * grams) / portionSize;
  if (mg === null) return null;
  const adiMg = adi.mgPerKg * weightKg;
  return { additiveId: amount.additiveId, mgConsumed: mg, adiMg, percentOfAdi: (mg / adiMg) * 100 };
}
