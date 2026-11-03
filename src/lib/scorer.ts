/**
 * Algoritmo chileno de evaluación de alimentos.
 *
 *   Score base = round(nutrición * 0.50 + NOVA * 0.20 + aditivos * 0.30)
 *
 * Nutrición según límites Fase 3 Ley 20.606 (MINSAL), siempre por 100 g / 100 ml.
 * Función pura: sin I/O, la usan la API, el panel de moderación, el seed y los tests.
 * Ver CLAUDE.md §4 para la especificación completa.
 */
import { KIDS_WARNING_SWEETENERS, parseSweetenerAmounts, type SweetenerAmount } from './sweeteners';
import { formatNumber, normalizeText } from './text';

/** Versión del método de puntaje. Subirla cuando cambien reglas o diccionario (se muestra en /metodologia y la API). */
export const METHODOLOGY_VERSION = '2.0';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Valores por 100 g (sólidos) o 100 ml (líquidos). Sodio en mg, el resto en g, calorías en kcal. */
export interface Nutrients {
  calories: number;
  sugars: number;
  saturatedFat: number;
  sodium: number;
  protein: number;
  fiber: number;
}

export interface RawProductInput {
  name: string;
  brand?: string;
  categorySlug: string;
  isLiquid: boolean;
  ingredientsRaw: string;
  nutrients: Nutrients;
}

export type MinsalSeal =
  | 'ALTO EN AZÚCARES'
  | 'ALTO EN GRASAS SATURADAS'
  | 'ALTO EN SODIO'
  | 'ALTO EN CALORÍAS';

export type NovaGroup = 1 | 2 | 3 | 4;
export type AdditiveLevel = 1 | 2 | 3;

export interface DetectedAdditive {
  id: string;
  name: string;
  code: string | null;
  level: AdditiveLevel;
  penalty: number;
  concern: string;
}

export interface NutritionBreakdown {
  base: number;
  sugarPenalty: number;
  saturatedFatPenalty: number;
  sodiumPenalty: number;
  proteinBonus: number;
  fiberBonus: number;
  novaBonus: number;
  /** Azúcar considerado para penalizar tras descontar lactosa intrínseca. */
  effectiveSugars: number;
}

export interface ProductEvaluation {
  finalScore: number;
  baseScore: number;
  nutritionScore: number;
  novaScore: number;
  additivesScore: number;
  novaGroup: NovaGroup;
  minsalSeals: MinsalSeal[];
  borderlineWarnings: string[];
  additives: DetectedAdditive[];
  multiSweetenerPenalty: boolean;
  hardCapReason: string | null;
  isFakeHealthy: boolean;
  ingredientCount: number;
  hasAddedSugar: boolean;
  industrialMarkers: string[];
  /** Excepciones de categoría natural aplicadas (lactosa intrínseca, alimento entero). */
  appliedExceptions: string[];
  nutritionBreakdown: NutritionBreakdown;
  basis: '100g' | '100ml';
  /** Edulcorantes detectados con la cantidad declarada en la etiqueta, si se pudo leer. */
  sweeteners: SweetenerAmount[];
  /** Aplicaría la leyenda "Contiene edulcorantes. Evite consumo en niños" (propuesta MINSAL, art. 120 ter). */
  kidsSweetenerWarning: boolean;
}

export interface Source {
  label: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Límites Ley 20.606 — Fase 3
// ---------------------------------------------------------------------------

export const MINSAL_LIMITS = {
  solid: { calories: 275, sugars: 10, saturatedFat: 4, sodium: 400 },
  liquid: { calories: 70, sugars: 5, saturatedFat: 3, sodium: 100 },
} as const;

const LACTOSE_ALLOWANCE_G = 4.8;
const BORDERLINE_RATIO = 0.9;

export const HARD_CAP_CRITICAL = 49;
export const HARD_CAP_SEALS = 35;
export const HARD_CAP_CRITICAL_REASON = 'Puntaje bloqueado en 49 por contener aditivos de riesgo crítico';
export const HARD_CAP_SEALS_REASON = 'Puntaje bloqueado en 35 por tener 3 o más sellos MINSAL';

// ---------------------------------------------------------------------------
// Diccionarios (sobre texto normalizado: minúsculas, sin tildes)
// ---------------------------------------------------------------------------

/** Marcadores de azúcar añadido. Se evalúan después de quitar frases como "sin azúcar añadida". */
const ADDED_SUGAR_RE =
  /\b(azucar(es)?|sacarosa|jarabe|miel|fructosa|dextrosa|maltodextrina|glucosa|concentrado\s+de\s+jugo)\b/;
const SUGAR_NEGATION_RE =
  /\b(sin|0%?|cero|no contiene|libre de)\s+(azucar(es)?|sacarosa)(\s+(anadid|agregad)[oa]s?)?\b/g;

const INDUSTRIAL_MARKERS_RE =
  /\b(maltodextrina|almidon\s+modificado|jarabe\s+de\s+glucosa|dextrosa|proteina\s+aislada\s+de\s+soya|suero\s+de\s+leche\s+en\s+polvo|aceite\s+vegetal\s+(hidrogenado|interesterificado|fraccionado)|saborizante\s+(identico\s+al\s+natural|artificial)|aroma\s+artificial|mono\s+y\s+digliceridos|polidextrosa|inulina)\b/gi;

/** Código SIN / INS / E: "SIN 250", "INS-407", "E466", "(sin 451i)". */
function codeRe(codes: (number | string)[]): string {
  return `\\b(?:sin|ins|e)\\s*[-.]?\\s*(?:${codes.join('|')})(?![0-9])`;
}

export interface AdditiveDefinition {
  id: string;
  name: string;
  code: string | null;
  level: AdditiveLevel;
  penalty: number;
  concern: string;
  /** Evidencia que respalda el nivel de riesgo (se muestra en /metodologia y en la ficha). */
  sources: Source[];
  pattern: RegExp;
}

function additive(
  def: Omit<AdditiveDefinition, 'pattern'> & { names: string; codes?: (number | string)[] },
): AdditiveDefinition {
  const { names, codes, ...rest } = def;
  const source = codes?.length ? `(?:${names})|${codeRe(codes)}` : names;
  return { ...rest, pattern: new RegExp(source) };
}

const SRC = {
  iarcProcessedMeat: {
    label: 'IARC/OMS (2015): carne procesada clasificada como carcinógena (Grupo 1)',
    url: 'https://www.iarc.who.int/wp-content/uploads/2018/07/pr240_E.pdf',
  },
  iarcList: { label: 'IARC: lista de agentes clasificados', url: 'https://monographs.iarc.who.int/list-of-classifications' },
  southampton: {
    label: 'McCann et al., The Lancet (2007): colorantes y benzoato, e hiperactividad infantil',
    url: 'https://doi.org/10.1016/S0140-6736(07)61306-3',
  },
  euAzoWarning: {
    label: 'Reglamento (CE) 1333/2008, anexo V: advertencia obligatoria en la UE',
    url: 'https://eur-lex.europa.eu/eli/reg/2008/1333/oj',
  },
  chassaing2015: {
    label: 'Chassaing et al., Nature (2015): emulsionantes CMC y P80 alteran la microbiota',
    url: 'https://doi.org/10.1038/nature14232',
  },
  chassaing2022: {
    label: 'Chassaing et al., Gastroenterology (2022): ensayo con CMC en humanos',
    url: 'https://doi.org/10.1053/j.gastro.2021.11.006',
  },
  efsaCarrageenan: {
    label: 'EFSA (2018): reevaluación de la carragenina (E 407)',
    url: 'https://doi.org/10.2903/j.efsa.2018.5238',
  },
  phosphates: {
    label: 'Ritz et al., Dtsch Arztebl Int (2012): aditivos de fosfato y salud',
    url: 'https://doi.org/10.3238/arztebl.2012.0049',
  },
  efsaGlutamate: {
    label: 'EFSA (2017): IDA de glutamatos de 30 mg/kg/día, superada por algunos grupos',
    url: 'https://doi.org/10.2903/j.efsa.2017.4910',
  },
  whoSweeteners: {
    label: 'OMS (2023): guía que desaconseja edulcorantes no calóricos para controlar el peso',
    url: 'https://www.who.int/publications/i/item/9789240073616',
  },
  aspartameIarc: {
    label: 'OMS/IARC/JECFA (2023): aspartamo como posible carcinógeno (2B)',
    url: 'https://www.who.int/news/item/14-07-2023-aspartame-hazard-and-risk-assessment-results-released',
  },
  sucralose6acetate: {
    label: 'Schiffman et al., J Toxicol Environ Health B (2023): sucralosa-6-acetato',
    url: 'https://doi.org/10.1080/10937404.2023.2213903',
  },
  erythritol: {
    label: 'Witkowski et al., Nature Medicine (2023): eritritol y riesgo cardiovascular',
    url: 'https://doi.org/10.1038/s41591-023-02223-9',
  },
  polyolsLaxative: {
    label: 'Reglamento (UE) 1169/2011, anexo III: advertencia de efecto laxante de polioles',
    url: 'https://eur-lex.europa.eu/eli/reg/2011/1169/oj',
  },
  efsaTitanium: {
    label: 'EFSA (2021): el dióxido de titanio (E 171) ya no se considera seguro',
    url: 'https://www.efsa.europa.eu/en/news/titanium-dioxide-e171-no-longer-considered-safe-when-used-food-additive',
  },
  fdaBenzene: {
    label: 'FDA: benceno en bebidas por benzoato + ácido ascórbico',
    url: 'https://www.fda.gov/food/environmental-contaminants-food/questions-and-answers-occurrence-benzene-soft-drinks-and-other-beverages',
  },
  hfcs: {
    label: 'Bray et al., Am J Clin Nutr (2004): JMAF en bebidas y obesidad',
    url: 'https://doi.org/10.1093/ajcn/79.4.537',
  },
} satisfies Record<string, Source>;

export const ADDITIVES: AdditiveDefinition[] = [
  // Nivel 3 — Crítico (−45 c/u)
  additive({
    id: 'nitritos-nitratos',
    name: 'Nitrito / Nitrato de sodio o potasio',
    code: 'SIN 249-252',
    level: 3,
    penalty: 45,
    concern: 'Forman nitrosaminas en carnes procesadas; la IARC/OMS clasifica la carne procesada como carcinógena (Grupo 1).',
    sources: [SRC.iarcProcessedMeat],
    names: '\\b(nitrit|nitrat)[oe]s?\\b',
    codes: [249, 250, 251, 252],
  }),
  additive({
    id: 'tartrazina',
    name: 'Tartrazina (Amarillo 5)',
    code: 'SIN 102',
    level: 3,
    penalty: 45,
    concern: 'Colorante azoico asociado a hiperactividad infantil; en la UE debe advertirse en el envase.',
    sources: [SRC.southampton, SRC.euAzoWarning],
    names: '\\btartrazina\\b|\\bamarillo\\s*(fdc\\s*)?(n\\W?\\s*)?5\\b',
    codes: [102],
  }),
  additive({
    id: 'amarillo-crepusculo',
    name: 'Amarillo crepúsculo (Amarillo 6)',
    code: 'SIN 110',
    level: 3,
    penalty: 45,
    concern: 'Colorante azoico asociado a hiperactividad infantil; en la UE debe advertirse en el envase.',
    sources: [SRC.southampton, SRC.euAzoWarning],
    names: '\\bamarillo\\s+(ocaso|crepusculo)\\b|\\bsunset\\s+yellow\\b|\\bamarillo\\s*(fdc\\s*)?(n\\W?\\s*)?6\\b',
    codes: [110],
  }),
  additive({
    id: 'rojo-allura',
    name: 'Rojo Allura AC (Rojo 40)',
    code: 'SIN 129',
    level: 3,
    penalty: 45,
    concern: 'Colorante azoico asociado a hiperactividad infantil; en la UE debe advertirse en el envase.',
    sources: [SRC.southampton, SRC.euAzoWarning],
    names: '\\ballura\\b|\\brojo\\s*(fdc\\s*)?(n\\W?\\s*)?40\\b',
    codes: [129],
  }),
  additive({
    id: 'bha-bht',
    name: 'BHA / BHT',
    code: 'SIN 320/321',
    level: 3,
    penalty: 45,
    concern: 'Antioxidantes sintéticos; la IARC clasifica el BHA como posible carcinógeno (Grupo 2B).',
    sources: [SRC.iarcList],
    names: '\\bbh[at]\\b|\\bbutil\\s*hidroxi\\s*(anisol|tolueno)\\b|\\bbutilhidroxi(anisol|tolueno)\\b',
    codes: [320, 321],
  }),
  additive({
    id: 'jmaf',
    name: 'Jarabe de maíz de alta fructosa',
    code: null,
    level: 3,
    penalty: 45,
    concern: 'Azúcar libre de absorción rápida; su consumo en bebidas se asocia a obesidad.',
    sources: [SRC.hfcs],
    names: '\\bjmaf\\b|\\bjarabe\\s+de\\s+(maiz\\s+(de\\s+)?)?alta\\s+fructosa\\b|\\bhigh\\s+fructose\\s+corn\\s+syrup\\b',
  }),
  additive({
    id: 'dioxido-titanio',
    name: 'Dióxido de titanio',
    code: 'SIN 171',
    level: 3,
    penalty: 45,
    concern: 'La EFSA concluyó en 2021 que no puede considerarse seguro (no se descarta genotoxicidad); prohibido en alimentos en la UE desde 2022.',
    sources: [SRC.efsaTitanium],
    names: '\\bdioxido\\s+de\\s+titanio\\b',
    codes: [171],
  }),

  // Nivel 2 — Moderado (−20 c/u)
  additive({
    id: 'carragenina',
    name: 'Carragenina',
    code: 'SIN 407',
    level: 2,
    penalty: 20,
    concern: 'Espesante asociado a inflamación intestinal en estudios experimentales; la EFSA pidió más datos de seguridad.',
    sources: [SRC.efsaCarrageenan],
    names: '\\bcarrage(nina|nano|nan|enan)s?\\b',
    codes: ['407a?'],
  }),
  additive({
    id: 'cmc',
    name: 'Carboximetilcelulosa (CMC)',
    code: 'SIN 466',
    level: 2,
    penalty: 20,
    concern: 'Emulsionante que alteró la microbiota y la mucosa intestinal en estudios en animales y en un ensayo en humanos.',
    sources: [SRC.chassaing2015, SRC.chassaing2022],
    names: '\\bcarboxi\\s*metil\\s*celulosa\\b|\\bcarboximetilcelulosa\\b|\\bcmc\\b',
    codes: [466],
  }),
  additive({
    id: 'polisorbatos',
    name: 'Polisorbatos (20/60/80)',
    code: 'SIN 432-436',
    level: 2,
    penalty: 20,
    concern: 'Emulsionantes que alteraron la barrera intestinal en modelos animales.',
    sources: [SRC.chassaing2015],
    names: '\\bpolisorbato',
    codes: [432, 433, 434, 435, 436],
  }),
  additive({
    id: 'polifosfatos',
    name: 'Polifosfatos / Trifosfatos',
    code: 'SIN 450-452',
    level: 2,
    penalty: 20,
    concern: 'Retienen agua en cárnicos; el fósforo añadido se absorbe casi por completo y su exceso se asocia a daño renal y vascular.',
    sources: [SRC.phosphates],
    names: '\\b(poli|tri|tripoli|di|piro)fosfato|\\bfosfato\\s+trisodico\\b',
    codes: [450, 451, 452],
  }),
  additive({
    id: 'glutamato',
    name: 'Glutamato monosódico',
    code: 'SIN 621',
    level: 2,
    penalty: 20,
    concern: 'Potenciador de sabor típico de ultraprocesados; la EFSA fijó una IDA que algunos grupos superan.',
    sources: [SRC.efsaGlutamate],
    names: '\\bglutamato\\b',
    codes: [621],
  }),
  additive({
    id: 'caramelo-iv',
    name: 'Caramelo amónico (clase III y IV)',
    code: 'SIN 150c/150d',
    level: 2,
    penalty: 20,
    concern: 'Su elaboración genera 4-metilimidazol (4-MEI), clasificado por la IARC como posible carcinógeno (Grupo 2B).',
    sources: [SRC.iarcList],
    names: '\\bcaramelo\\s+(clase\\s+)?(iii|iv|3|4)\\b|\\bcaramelo\\s+(de\\s+)?(sulfito\\s+)?amonic[oa]\\b|\\bcaramelo\\s+amonico\\b',
    codes: ['150\\s*[cd]'],
  }),
  additive({
    id: 'benzoatos',
    name: 'Benzoatos (ácido benzoico, benzoato de sodio o potasio)',
    code: 'SIN 210-213',
    level: 2,
    penalty: 20,
    concern: 'Con ácido ascórbico puede formar benceno en bebidas; asociado a hiperactividad junto a colorantes azoicos.',
    sources: [SRC.fdaBenzene, SRC.southampton],
    names: '\\bbenzoat[oe]s?\\b|\\bacido\\s+benzoico\\b',
    codes: [210, 211, 212, 213],
  }),

  // Nivel 1 — Edulcorantes "trampa sin sellos"
  additive({
    id: 'sucralosa',
    name: 'Sucralosa',
    code: 'SIN 955',
    level: 1,
    penalty: 15,
    concern: 'Edulcorante artificial: permite esquivar el sello de azúcar manteniendo el gusto dulce.',
    sources: [SRC.whoSweeteners, SRC.sucralose6acetate],
    names: '\\bsucralosa\\b',
    codes: [955],
  }),
  additive({
    id: 'acesulfamo-k',
    name: 'Acesulfamo K',
    code: 'SIN 950',
    level: 1,
    penalty: 15,
    concern: 'Edulcorante artificial: permite esquivar el sello de azúcar manteniendo el gusto dulce.',
    sources: [SRC.whoSweeteners],
    names: '\\bacesulfam[oe]?\\b',
    codes: [950],
  }),
  additive({
    id: 'aspartamo',
    name: 'Aspartamo',
    code: 'SIN 951',
    level: 1,
    penalty: 15,
    concern: 'Edulcorante artificial clasificado como posible carcinógeno (IARC 2B, 2023).',
    sources: [SRC.aspartameIarc, SRC.whoSweeteners],
    names: '\\baspartam[oe]\\b',
    codes: [951],
  }),
  additive({
    id: 'ciclamato',
    name: 'Ciclamato',
    code: 'SIN 952',
    level: 1,
    penalty: 15,
    concern: 'Edulcorante artificial; no está autorizado en alimentos en EE.UU.',
    sources: [SRC.whoSweeteners],
    names: '\\bciclamat[oe]s?\\b',
    codes: [952],
  }),
  additive({
    id: 'sacarina',
    name: 'Sacarina',
    code: 'SIN 954',
    level: 1,
    penalty: 15,
    concern: 'Edulcorante artificial: permite esquivar el sello de azúcar manteniendo el gusto dulce.',
    sources: [SRC.whoSweeteners],
    names: '\\bsacarina\\b',
    codes: [954],
  }),
  additive({
    id: 'polioles',
    name: 'Polioles (maltitol, sorbitol, eritritol, xilitol…)',
    code: 'SIN 420/421/953/965-968',
    level: 1,
    penalty: 10,
    concern: 'Azúcares-alcohol usados en productos "sin azúcar"; en exceso tienen efecto laxante y el eritritol se investiga por riesgo cardiovascular.',
    sources: [SRC.polyolsLaxative, SRC.erythritol],
    names: '\\b(maltitol|sorbitol|eritritol|xilitol|isomalt|isomaltitol|lactitol|manitol)\\b|\\bjarabe\\s+de\\s+maltitol\\b',
    codes: [420, 421, 953, 965, 966, 967, 968],
  }),
  additive({
    id: 'stevia',
    name: 'Stevia (glicósidos de esteviol)',
    code: 'SIN 960',
    level: 1,
    penalty: 5,
    concern: 'Edulcorante de origen vegetal; mantiene el hábito de sabor dulce.',
    sources: [SRC.whoSweeteners],
    names: '\\bstevia\\b|\\bestevia\\b|\\b(glicosido|glucosido)s?\\s+de\\s+esteviol\\b|\\brebaudiosido',
    codes: [960],
  }),
  additive({
    id: 'alulosa',
    name: 'Alulosa',
    code: null,
    level: 1,
    penalty: 5,
    concern: 'Azúcar raro usado como edulcorante; mantiene el hábito de sabor dulce.',
    sources: [SRC.whoSweeteners],
    names: '\\ba?l+ulosa\\b|\\bpsicosa\\b',
  }),
];

export const getAdditiveDefinition = (id: string) => ADDITIVES.find((a) => a.id === id);

const MULTI_SWEETENER_PENALTY = 10;

// ---------------------------------------------------------------------------
// Ingredientes
// ---------------------------------------------------------------------------

/** Quita prefijo "Ingredientes:", declaraciones de alérgenos y trazas. */
function cleanIngredients(normalized: string): string {
  return normalized
    .replace(/^ingredientes?\s*:\s*/, '')
    .replace(/\b(puede contener|contiene trazas|elaborado en (una )?(linea|planta)|contiene:?\s+(leche|gluten|soya|soja|huevo|trigo|frutos)).*$/, '')
    // Declaración de cantidad de edulcorantes ("Contiene 12 mg de sucralosa por 100 ml"): no es un ingrediente.
    .replace(/\b(contiene|aporta)\s+\d+([.,]\d+)?\s*mg\b.*$/, '')
    .replace(/[.\s]+$/, '');
}

/**
 * Ingredientes de primer nivel: separa por coma, punto y coma o " y " final ("sal y levadura"),
 * siempre fuera de paréntesis. "mono y digliceridos" es un solo ingrediente.
 */
export function splitIngredients(ingredientsRaw: string): string[] {
  const text = cleanIngredients(normalizeText(ingredientsRaw));
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    const isSeparator = ch === ',' || ch === ';';
    const isConjunction = text.startsWith(' y ', i) && !/\bmono$/.test(current);
    if (depth === 0 && (isSeparator || isConjunction)) {
      parts.push(current);
      current = '';
      if (isConjunction) i += 2;
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function detectAdditives(normalizedIngredients: string): DetectedAdditive[] {
  return ADDITIVES.filter((a) => a.pattern.test(normalizedIngredients)).map(
    ({ pattern: _pattern, sources: _sources, ...rest }) => rest,
  );
}

export function hasAddedSugarMarker(normalizedIngredients: string): boolean {
  return ADDED_SUGAR_RE.test(normalizedIngredients.replace(SUGAR_NEGATION_RE, ' '));
}

// ---------------------------------------------------------------------------
// Pilares
// ---------------------------------------------------------------------------

const NOVA_SCORES: Record<NovaGroup, number> = { 1: 100, 2: 80, 3: 50, 4: 0 };

function classifyNova(
  ingredientCount: number,
  additives: DetectedAdditive[],
  industrialMarkers: string[],
): NovaGroup {
  if (ingredientCount > 7 || additives.length > 0 || industrialMarkers.length > 0) return 4;
  if (ingredientCount >= 3) return 3;
  if (ingredientCount === 2) return 2;
  if (ingredientCount === 1) return 1;
  // Sin lista de ingredientes no se puede afirmar que sea mínimamente procesado.
  return 3;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

const NUTRIENT_LABELS = {
  calories: { label: 'Calorías', unit: 'kcal', seal: 'ALTO EN CALORÍAS' },
  sugars: { label: 'Azúcares', unit: 'g', seal: 'ALTO EN AZÚCARES' },
  saturatedFat: { label: 'Grasas saturadas', unit: 'g', seal: 'ALTO EN GRASAS SATURADAS' },
  sodium: { label: 'Sodio', unit: 'mg', seal: 'ALTO EN SODIO' },
} as const satisfies Record<string, { label: string; unit: string; seal: MinsalSeal }>;

type CriticalNutrient = keyof typeof NUTRIENT_LABELS;

// ---------------------------------------------------------------------------
// evaluateProduct
// ---------------------------------------------------------------------------

export function evaluateProduct(product: RawProductInput): ProductEvaluation {
  const n = product.nutrients;
  const limits = product.isLiquid ? MINSAL_LIMITS.liquid : MINSAL_LIMITS.solid;
  const normalized = cleanIngredients(normalizeText(product.ingredientsRaw));
  const ingredients = splitIngredients(product.ingredientsRaw);
  const ingredientCount = ingredients.length;

  // --- Pilar 3: aditivos -----------------------------------------------------
  const additives = detectAdditives(normalized);
  const sweeteners = additives.filter((a) => a.level === 1);
  const multiSweetenerPenalty = sweeteners.length >= 2;
  const additivePenalty =
    additives.reduce((sum, a) => sum + a.penalty, 0) + (multiSweetenerPenalty ? MULTI_SWEETENER_PENALTY : 0);
  const additivesScore = clamp(100 - additivePenalty, 0, 100);

  // --- Pilar 2: NOVA ---------------------------------------------------------
  const industrialMarkers = [...new Set([...normalized.matchAll(INDUSTRIAL_MARKERS_RE)].map((m) => m[0]))];
  const novaGroup = classifyNova(ingredientCount, additives, industrialMarkers);
  const novaScore = NOVA_SCORES[novaGroup];

  // --- Excepciones de categoría natural --------------------------------------
  const hasAddedSugar = hasAddedSugarMarker(normalized);
  const appliedExceptions: string[] = [];

  const isWholeFood = (novaGroup === 1 || novaGroup === 2) && ingredientCount === 1;
  if (isWholeFood) {
    appliedExceptions.push('Alimento entero de 1 ingrediente: calorías y grasas saturadas intrínsecas no penalizan');
  }

  const category = product.categorySlug.toLowerCase();
  const lactoseApplies = (category.includes('lacteo') || category.includes('yogur')) && !hasAddedSugar;
  const effectiveSugars = lactoseApplies ? Math.max(0, n.sugars - LACTOSE_ALLOWANCE_G) : n.sugars;
  if (lactoseApplies && n.sugars > 0) {
    appliedExceptions.push(
      `Lactosa intrínseca: se descuentan ${formatNumber(Math.min(n.sugars, LACTOSE_ALLOWANCE_G))}g de azúcar natural de la leche`,
    );
  }

  // --- Sellos MINSAL y alertas "casi sello" ----------------------------------
  // Un nutriente solo puede llevar sello si es "añadido": el azúcar exige marcador de azúcar
  // añadido y un alimento entero no lleva sello por sus calorías o grasa propias.
  const canCarrySeal: Record<CriticalNutrient, boolean> = {
    calories: !isWholeFood,
    sugars: hasAddedSugar,
    saturatedFat: !isWholeFood,
    sodium: true,
  };

  const minsalSeals: MinsalSeal[] = [];
  const borderlineWarnings: string[] = [];
  for (const key of ['sugars', 'saturatedFat', 'sodium', 'calories'] as const) {
    if (!canCarrySeal[key]) continue;
    const value = n[key];
    const limit = limits[key];
    const { label, unit, seal } = NUTRIENT_LABELS[key];
    if (value > limit) {
      minsalSeals.push(seal);
    } else if (value >= limit * BORDERLINE_RATIO) {
      borderlineWarnings.push(`${label} al límite legal (${formatNumber(value)}${unit} / ${limit}${unit})`);
    }
  }

  // --- Pilar 1: nutrición ----------------------------------------------------
  const sugarPenalty = Math.min(20, (effectiveSugars / limits.sugars) * 20);
  const saturatedFatPenalty = isWholeFood ? 0 : Math.min(15, (n.saturatedFat / limits.saturatedFat) * 15);
  const sodiumPenalty = Math.min(15, (n.sodium / limits.sodium) * 15);
  const proteinBonus = Math.min(20, (n.protein / 2) * 5);
  const fiberBonus = Math.min(15, (n.fiber / 1.5) * 8);
  const novaBonus = novaGroup <= 3 ? 15 : 0;

  const nutritionScore = Math.round(
    clamp(50 - sugarPenalty - saturatedFatPenalty - sodiumPenalty + proteinBonus + fiberBonus + novaBonus, 0, 100),
  );

  // --- Ponderación y hard caps -----------------------------------------------
  // = round(n * 0.50 + nova * 0.20 + aditivos * 0.30), en enteros para que x.5 redondee sin error de coma flotante.
  const baseScore = Math.round((nutritionScore * 50 + novaScore * 20 + additivesScore * 30) / 100);

  let finalScore = baseScore;
  let hardCapReason: string | null = null;
  if (additives.some((a) => a.level === 3) && finalScore > HARD_CAP_CRITICAL) {
    finalScore = HARD_CAP_CRITICAL;
    hardCapReason = HARD_CAP_CRITICAL_REASON;
  }
  if (minsalSeals.length >= 3 && finalScore > HARD_CAP_SEALS) {
    finalScore = HARD_CAP_SEALS;
    hardCapReason = HARD_CAP_SEALS_REASON;
  }

  const isFakeHealthy = minsalSeals.length === 0 && novaGroup === 4 && additives.length > 0;

  return {
    finalScore,
    baseScore,
    nutritionScore,
    novaScore,
    additivesScore,
    novaGroup,
    minsalSeals,
    borderlineWarnings,
    additives,
    multiSweetenerPenalty,
    hardCapReason,
    isFakeHealthy,
    ingredientCount,
    hasAddedSugar,
    industrialMarkers,
    appliedExceptions,
    nutritionBreakdown: {
      base: 50,
      sugarPenalty: round1(sugarPenalty),
      saturatedFatPenalty: round1(saturatedFatPenalty),
      sodiumPenalty: round1(sodiumPenalty),
      proteinBonus: round1(proteinBonus),
      fiberBonus: round1(fiberBonus),
      novaBonus,
      effectiveSugars: round1(effectiveSugars),
    },
    basis: product.isLiquid ? '100ml' : '100g',
    // Se lee del texto sin limpiar: la cantidad suele venir al final ("Contiene 12 mg de sucralosa por 100 ml").
    sweeteners: parseSweetenerAmounts(
      normalizeText(product.ingredientsRaw),
      sweeteners.map((s) => s.id),
    ),
    kidsSweetenerWarning: sweeteners.some((s) => KIDS_WARNING_SWEETENERS.has(s.id)),
  };
}

// ---------------------------------------------------------------------------
// Helpers de presentación compartidos (servidor y cliente)
// ---------------------------------------------------------------------------

export type ScoreTier = 'good' | 'medium' | 'bad';

/** Verde ≥ 75, ámbar 50–74, rojo < 50. */
export function scoreTier(score: number): ScoreTier {
  if (score >= 75) return 'good';
  if (score >= 50) return 'medium';
  return 'bad';
}

export const NOVA_LABELS: Record<NovaGroup, string> = {
  1: 'Natural o mínimamente procesado',
  2: 'Ingrediente culinario procesado',
  3: 'Alimento procesado',
  4: 'Ultraprocesado',
};

export const ADDITIVE_LEVEL_LABELS: Record<AdditiveLevel, string> = {
  3: 'Riesgo crítico',
  2: 'Riesgo moderado',
  1: 'Edulcorante',
};
