import { describe, expect, it } from 'vitest';
import { validateExtraction, type LabelExtraction } from './label-extractor';

const valid: LabelExtraction = {
  isValidLabel: true,
  rejectionReason: '',
  productName: 'Yogurt',
  brand: 'Demo',
  categorySlug: 'yogures-y-lacteos',
  isLiquid: false,
  ingredientsRaw: 'Leche, fermentos lácticos.',
  nutrients: { calories: 62, sugars: 4.7, saturatedFat: 2, sodium: 50, protein: 3.4, fiber: 0 },
  portionSize: 125,
};

describe('validateExtraction (guardia anti-alucinación)', () => {
  it('acepta una lectura plausible', () => {
    expect(validateExtraction(valid)).toBeNull();
  });

  it('rechaza cuando la IA dice que no es una etiqueta válida', () => {
    expect(validateExtraction({ ...valid, isValidLabel: false, rejectionReason: 'Foto borrosa' })).toBe('Foto borrosa');
  });

  it('rechaza si azúcares + grasa sat. + proteína + fibra > 102 g', () => {
    const n = { ...valid.nutrients, sugars: 60, saturatedFat: 20, protein: 20, fiber: 3 };
    expect(validateExtraction({ ...valid, nutrients: n })).toMatch(/columna por porción/);
  });

  it('acepta justo 102 g', () => {
    const n = { ...valid.nutrients, sugars: 60, saturatedFat: 20, protein: 20, fiber: 2 };
    expect(validateExtraction({ ...valid, nutrients: n })).toBeNull();
  });

  it('rechaza calorías > 905', () => {
    expect(validateExtraction({ ...valid, nutrients: { ...valid.nutrients, calories: 906 } })).toMatch(/calorías/);
  });

  it('rechaza valores negativos o faltantes', () => {
    expect(validateExtraction({ ...valid, nutrients: { ...valid.nutrients, sodium: -1 } })).not.toBeNull();
    expect(validateExtraction({ ...valid, ingredientsRaw: '  ' })).not.toBeNull();
  });
});
