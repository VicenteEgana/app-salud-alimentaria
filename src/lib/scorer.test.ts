import { describe, expect, it } from 'vitest';
import { SEED_PRODUCTS } from '../../scripts/seed-data';
import {
  HARD_CAP_CRITICAL_REASON,
  HARD_CAP_SEALS_REASON,
  evaluateProduct,
  splitIngredients,
  type RawProductInput,
} from './scorer';
import { isValidEan, slugify } from './text';

const seed = (name: string): RawProductInput => {
  const product = SEED_PRODUCTS.find((p) => p.name === name);
  if (!product) throw new Error(`Seed no encontrado: ${name}`);
  return product;
};

describe('evaluateProduct — productos semilla (puntajes calculados a mano)', () => {
  it('Yogurt natural: lactosa intrínseca descontada, NOVA 2, sin sellos → 78', () => {
    const e = evaluateProduct(seed('Yogurt Natural Sin Endulzar'));
    expect(e.novaGroup).toBe(2);
    expect(e.nutritionBreakdown.effectiveSugars).toBe(0);
    expect(e.nutritionBreakdown.sugarPenalty).toBe(0);
    expect(e.nutritionScore).toBe(64);
    expect(e.minsalSeals).toEqual([]);
    expect(e.appliedExceptions.some((x) => x.startsWith('Lactosa intrínseca'))).toBe(true);
    expect(e.finalScore).toBe(78);
    expect(e.isFakeHealthy).toBe(false);
  });

  it('Yogurt protein: sucralosa + acesulfamo K + carragenina → falso saludable, 46', () => {
    const e = evaluateProduct(seed('Yogurt Protein Vainilla 0% Azúcar'));
    expect(e.additives.map((a) => a.id).sort()).toEqual(['acesulfamo-k', 'carragenina', 'sucralosa']);
    expect(e.multiSweetenerPenalty).toBe(true);
    expect(e.additivesScore).toBe(40); // 100 − 20 − 15 − 15 − 10
    expect(e.novaGroup).toBe(4);
    expect(e.nutritionScore).toBe(68);
    expect(e.minsalSeals).toEqual([]);
    expect(e.isFakeHealthy).toBe(true);
    expect(e.finalScore).toBe(46);
  });

  it('Yogurt frutilla: azúcar añadida anula la lactosa, sello de azúcares, rojo allura → 32', () => {
    const e = evaluateProduct(seed('Yogurt Batido Frutilla'));
    expect(e.hasAddedSugar).toBe(true);
    expect(e.appliedExceptions).toEqual([]);
    expect(e.minsalSeals).toEqual(['ALTO EN AZÚCARES']);
    expect(e.additives.map((a) => a.id)).toEqual(['rojo-allura']);
    expect(e.finalScore).toBe(32);
    expect(e.hardCapReason).toBeNull(); // ya está bajo 49, el tope no actúa
    expect(e.isFakeHealthy).toBe(false);
  });

  it('Leche sin lactosa: evaluada con límites de líquidos → 79', () => {
    const e = evaluateProduct(seed('Leche Descremada Sin Lactosa'));
    expect(e.basis).toBe('100ml');
    expect(e.nutritionBreakdown.sodiumPenalty).toBe(6.8); // 45 / 100 mg
    expect(e.nutritionScore).toBe(66);
    expect(e.finalScore).toBe(79);
  });

  it('Pan masa madre: NOVA 3, casi-sello de sodio → 80', () => {
    const e = evaluateProduct(seed('Pan Integral Masa Madre'));
    expect(e.novaGroup).toBe(3);
    expect(e.borderlineWarnings).toEqual(['Sodio al límite legal (380mg / 400mg)']);
    expect(e.minsalSeals).toEqual([]);
    expect(e.finalScore).toBe(80);
  });

  it('Pan cero sellos: CMC + sucralosa, sodio 390 mg → falso saludable, 51', () => {
    const e = evaluateProduct(seed('Pan Blanco Cero Sellos'));
    expect(e.minsalSeals).toEqual([]);
    expect(e.borderlineWarnings).toEqual([
      'Sodio al límite legal (390mg / 400mg)',
      'Calorías al límite legal (255kcal / 275kcal)',
    ]);
    expect(e.additives.map((a) => a.id).sort()).toEqual(['cmc', 'sucralosa']);
    expect(e.multiSweetenerPenalty).toBe(false);
    expect(e.industrialMarkers).toContain('mono y digliceridos');
    expect(e.isFakeHealthy).toBe(true);
    expect(e.baseScore).toBe(51); // 50.5 redondea hacia arriba
    expect(e.finalScore).toBe(51);
  });

  it('Pan multigrano con JMAF: base 51 bloqueada en 49 por aditivo crítico', () => {
    const e = evaluateProduct(seed('Pan Multigrano Fibra+'));
    expect(e.additives.map((a) => a.id)).toEqual(['jmaf']);
    expect(e.baseScore).toBe(51);
    expect(e.finalScore).toBe(49);
    expect(e.hardCapReason).toBe(HARD_CAP_CRITICAL_REASON);
    expect(e.isFakeHealthy).toBe(true);
  });

  it('Pavo light: nitrito + polifosfatos + carragenina, 0 sellos → falso saludable, 30', () => {
    const e = evaluateProduct(seed('Pechuga de Pavo Cocida Light'));
    expect(e.additives.map((a) => a.id).sort()).toEqual(['carragenina', 'nitritos-nitratos', 'polifosfatos']);
    expect(e.additivesScore).toBe(15);
    expect(e.minsalSeals).toEqual([]);
    expect(e.borderlineWarnings).toEqual(['Sodio al límite legal (395mg / 400mg)']);
    expect(e.isFakeHealthy).toBe(true);
    expect(e.finalScore).toBe(30);
  });

  it('Salame artesanal: sin aditivos pero 3 sellos → base 67 bloqueada en 35', () => {
    const e = evaluateProduct(seed('Salame Artesanal Curado'));
    expect(e.novaGroup).toBe(3);
    expect(e.minsalSeals).toEqual(['ALTO EN GRASAS SATURADAS', 'ALTO EN SODIO', 'ALTO EN CALORÍAS']);
    expect(e.baseScore).toBe(67);
    expect(e.finalScore).toBe(35);
    expect(e.hardCapReason).toBe(HARD_CAP_SEALS_REASON);
  });

  it('Vienesas: 2 sellos, nitrito, polifosfatos y glutamato → 23', () => {
    const e = evaluateProduct(seed('Vienesas de Pollo y Cerdo'));
    expect(e.minsalSeals).toEqual(['ALTO EN GRASAS SATURADAS', 'ALTO EN SODIO']);
    expect(e.borderlineWarnings).toEqual(['Calorías al límite legal (265kcal / 275kcal)']);
    expect(e.additives.map((a) => a.id).sort()).toEqual(['glutamato', 'nitritos-nitratos', 'polifosfatos']);
    expect(e.finalScore).toBe(23);
    expect(e.isFakeHealthy).toBe(false);
  });
});

describe('evaluateProduct — reglas puntuales', () => {
  const base: RawProductInput = {
    name: 'Test',
    categorySlug: 'otros',
    isLiquid: false,
    ingredientsRaw: 'Agua.',
    nutrients: { calories: 0, sugars: 0, saturatedFat: 0, sodium: 0, protein: 0, fiber: 0 },
  };

  it('Alimento entero de 1 ingrediente: calorías y grasa saturada no penalizan ni llevan sello', () => {
    const e = evaluateProduct({
      ...base,
      categorySlug: 'frutos-secos',
      ingredientsRaw: 'Maní.',
      nutrients: { calories: 590, sugars: 4, saturatedFat: 7, sodium: 10, protein: 26, fiber: 8.5 },
    });
    expect(e.novaGroup).toBe(1);
    expect(e.nutritionBreakdown.saturatedFatPenalty).toBe(0);
    expect(e.minsalSeals).toEqual([]);
    expect(e.nutritionScore).toBe(92);
    expect(e.finalScore).toBe(96);
  });

  it('Sello de azúcares solo con marcador de azúcar añadido', () => {
    const natural = evaluateProduct({ ...base, ingredientsRaw: 'Pasas.', nutrients: { ...base.nutrients, sugars: 60 } });
    expect(natural.minsalSeals).not.toContain('ALTO EN AZÚCARES');
    const added = evaluateProduct({
      ...base,
      ingredientsRaw: 'Pasas, azúcar.',
      nutrients: { ...base.nutrients, sugars: 60 },
    });
    expect(added.minsalSeals).toContain('ALTO EN AZÚCARES');
  });

  it('"Sin azúcar añadida" no cuenta como azúcar añadido', () => {
    const e = evaluateProduct({ ...base, ingredientsRaw: 'Leche, cacao. Sin azúcar añadida.' });
    expect(e.hasAddedSugar).toBe(false);
  });

  it('Detecta aditivos por código SIN / INS / E', () => {
    const e = evaluateProduct({ ...base, ingredientsRaw: 'Agua, espesante (INS 466), colorante (E102), SIN 451i.' });
    expect(e.additives.map((a) => a.id).sort()).toEqual(['cmc', 'polifosfatos', 'tartrazina']);
  });

  it('Stevia sola resta 5; dos edulcorantes activan castigo por mezcla', () => {
    const one = evaluateProduct({ ...base, ingredientsRaw: 'Agua, jugo de limón, stevia.' });
    expect(one.additivesScore).toBe(95);
    expect(one.multiSweetenerPenalty).toBe(false);
    const two = evaluateProduct({ ...base, ingredientsRaw: 'Agua, jugo de limón, stevia, aspartamo.' });
    expect(two.additivesScore).toBe(70); // 100 − 5 − 15 − 10
    expect(two.multiSweetenerPenalty).toBe(true);
  });

  it('Más de 7 ingredientes es NOVA 4 aunque no haya aditivos', () => {
    const e = evaluateProduct({ ...base, ingredientsRaw: 'a, b, c, d, e, f, g, h' });
    expect(e.ingredientCount).toBe(8);
    expect(e.novaGroup).toBe(4);
  });

  it('Casi-sello entre 90 % y el límite, no bajo 90 %', () => {
    const at89 = evaluateProduct({ ...base, ingredientsRaw: 'Agua, sal.', nutrients: { ...base.nutrients, sodium: 356 } });
    expect(at89.borderlineWarnings).toEqual([]);
    const at90 = evaluateProduct({ ...base, ingredientsRaw: 'Agua, sal.', nutrients: { ...base.nutrients, sodium: 360 } });
    expect(at90.borderlineWarnings).toEqual(['Sodio al límite legal (360mg / 400mg)']);
    const over = evaluateProduct({ ...base, ingredientsRaw: 'Agua, sal.', nutrients: { ...base.nutrients, sodium: 401 } });
    expect(over.minsalSeals).toEqual(['ALTO EN SODIO']);
    expect(over.borderlineWarnings).toEqual([]);
  });
});

describe('splitIngredients', () => {
  it('no corta dentro de paréntesis, corta en " y " final, respeta "mono y diglicéridos"', () => {
    expect(splitIngredients('Ingredientes: Harina, agua, emulsionante (mono y diglicéridos, lecitina), sal y levadura.')).toEqual([
      'harina',
      'agua',
      'emulsionante (mono y digliceridos, lecitina)',
      'sal',
      'levadura',
    ]);
    expect(splitIngredients('Harina, mono y digliceridos')).toEqual(['harina', 'mono y digliceridos']);
  });

  it('ignora la declaración de trazas', () => {
    expect(splitIngredients('Maní tostado. Puede contener trazas de almendras.')).toEqual(['mani tostado']);
  });
});

describe('text helpers', () => {
  it('slugify nunca produce el separador -vs-', () => {
    expect(slugify('Pan VS Pan')).toBe('pan-v-pan');
    expect(slugify('Yogurt Protein Vainilla 0% Azúcar')).toBe('yogurt-protein-vainilla-0-azucar');
  });

  it('valida dígito verificador EAN', () => {
    expect(isValidEan('2000000000015')).toBe(true);
    expect(isValidEan('2000000000016')).toBe(false);
    expect(isValidEan('7802900001')).toBe(false);
  });
});
