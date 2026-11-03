/**
 * Cascada nivel 3: lectura de la etiqueta con Gemini 2.5 Flash (Structured Outputs).
 * Extrae ingredientes y SOLO la columna "100 g / 100 ml" de la tabla nutricional.
 */
import { CATEGORIES } from './categories';
import type { Nutrients } from './scorer';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface LabelExtraction {
  isValidLabel: boolean;
  rejectionReason: string;
  productName: string;
  brand: string;
  categorySlug: string;
  isLiquid: boolean;
  ingredientsRaw: string;
  nutrients: Nutrients;
  /** Tamaño de la porción en g o ml; 0 si no aparece. */
  portionSize: number;
}

const CATEGORY_SLUGS = [...CATEGORIES.map((c) => c.slug), 'otros'];

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isValidLabel: {
      type: 'BOOLEAN',
      description: 'true solo si la foto muestra legiblemente la lista de ingredientes Y la tabla nutricional con columna por 100 g o 100 ml.',
    },
    rejectionReason: { type: 'STRING', description: 'Si isValidLabel es false, el motivo en español. Si no, cadena vacía.' },
    productName: { type: 'STRING' },
    brand: { type: 'STRING' },
    categorySlug: { type: 'STRING', enum: CATEGORY_SLUGS },
    isLiquid: { type: 'BOOLEAN', description: 'true si la tabla está expresada por 100 ml.' },
    ingredientsRaw: {
      type: 'STRING',
      description:
        'Lista de ingredientes transcrita literalmente, incluidos aditivos, códigos SIN/INS y la declaración de cantidad de edulcorantes (ej. "Contiene 12 mg de sucralosa por 100 ml").',
    },
    portionSize: { type: 'NUMBER', description: 'Tamaño de 1 porción en g o ml según la tabla; 0 si no aparece.' },
    nutrients: {
      type: 'OBJECT',
      properties: {
        calories: { type: 'NUMBER', description: 'Energía en kcal por 100 g/ml' },
        sugars: { type: 'NUMBER', description: 'Azúcares totales en g por 100 g/ml' },
        saturatedFat: { type: 'NUMBER', description: 'Grasas saturadas en g por 100 g/ml' },
        sodium: { type: 'NUMBER', description: 'Sodio en mg por 100 g/ml' },
        protein: { type: 'NUMBER', description: 'Proteínas en g por 100 g/ml' },
        fiber: { type: 'NUMBER', description: 'Fibra dietética total en g por 100 g/ml; 0 si no se declara' },
      },
      required: ['calories', 'sugars', 'saturatedFat', 'sodium', 'protein', 'fiber'],
    },
  },
  required: [
    'isValidLabel',
    'rejectionReason',
    'productName',
    'brand',
    'categorySlug',
    'isLiquid',
    'ingredientsRaw',
    'nutrients',
    'portionSize',
  ],
};

function buildPrompt(productNameHint: string): string {
  return `Eres un extractor de etiquetas de alimentos envasados chilenos (Ley 20.606).
Analiza la foto y devuelve JSON con el esquema indicado.

Reglas estrictas:
- Usa EXCLUSIVAMENTE la columna "100 g" o "100 ml" de la tabla nutricional. Ignora por completo la columna "1 porción" / "por porción".
- Si el sodio aparece en gramos, conviértelo a miligramos (× 1000).
- Si la energía aparece solo en kJ, conviértela a kcal (÷ 4.184).
- Si un nutriente no aparece, usa 0 solo para fibra; si falta energía, azúcares, grasas saturadas o sodio, marca isValidLabel = false.
- Transcribe los ingredientes tal cual aparecen, sin resumir ni traducir. Si el envase declara cuántos mg de edulcorante contiene, agrégalo al final de ingredientsRaw tal cual.
- No inventes valores. Si la foto está borrosa, cortada o no es una etiqueta de alimento, isValidLabel = false.
- Pista del usuario sobre el producto (puede estar vacía o ser imprecisa): "${productNameHint.replace(/"/g, "'").slice(0, 120)}"
- categorySlug: elige la categoría que mejor calce; "otros" si ninguna.`;
}

export class LabelExtractionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function extractLabel(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  productNameHint: string,
): Promise<LabelExtraction> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: buildPrompt(productNameHint) }, { inline_data: { mime_type: mimeType, data: imageBase64 } }],
        },
      ],
      generationConfig: {
        temperature: 0,
        response_mime_type: 'application/json',
        response_schema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Gemini error', res.status, detail.slice(0, 500));
    throw new LabelExtractionError('El servicio de lectura de etiquetas no está disponible', 502);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string')?.text;
  if (!text) throw new LabelExtractionError('La IA no devolvió una lectura de la etiqueta', 502);

  try {
    return JSON.parse(text) as LabelExtraction;
  } catch {
    throw new LabelExtractionError('La IA devolvió una respuesta ilegible', 502);
  }
}

/**
 * Guardia anti-alucinación. Devuelve el motivo de rechazo o null si la lectura es plausible.
 * Por 100 g no puede haber más de ~100 g de macronutrientes ni más de ~900 kcal (grasa pura).
 */
export function validateExtraction(x: LabelExtraction): string | null {
  if (!x.isValidLabel) return x.rejectionReason || 'La foto no muestra una etiqueta nutricional legible';
  const n = x.nutrients;
  const values = [n.calories, n.sugars, n.saturatedFat, n.sodium, n.protein, n.fiber];
  if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
    return 'La tabla nutricional leída tiene valores inválidos';
  }
  if (n.sugars + n.saturatedFat + n.protein + n.fiber > 102) {
    return 'La suma de nutrientes supera los 100 g: probablemente se leyó la columna por porción';
  }
  if (n.calories > 905) return 'Las calorías leídas superan el máximo físico posible por 100 g';
  if (!x.ingredientsRaw?.trim()) return 'No se pudo leer la lista de ingredientes';
  return null;
}
