import type { RawProductInput } from '../src/lib/scorer';

export interface SeedProduct extends RawProductInput {
  ean: string;
  brand: string;
  imageUrl: string | null;
  portionText: string;
  portionSize: number;
}

/**
 * 10 productos representativos del supermercado chileno para desarrollo local.
 *
 * Las formulaciones y tablas nutricionales replican casos típicos de góndola (yogur natural,
 * yogur "protein" con edulcorantes, pan "cero sellos" con CMC, pavo con nitrito...), pero usan
 * marcas ficticias y EAN de circulación restringida (prefijo 200) a propósito: los datos de
 * marcas reales deben entrar por scripts/ingest-chile.ts desde la etiqueta real.
 *
 * El puntaje esperado de cada uno está verificado en src/lib/scorer.test.ts.
 */
export const SEED_PRODUCTS: SeedProduct[] = [
  // --- yogures-y-lacteos -----------------------------------------------------
  {
    ean: '2000000000015',
    portionText: '1 pote (125 g)',
    portionSize: 125,
    name: 'Yogurt Natural Sin Endulzar',
    brand: 'Lácteos del Sur (demo)',
    categorySlug: 'yogures-y-lacteos',
    isLiquid: false,
    imageUrl: null,
    ingredientsRaw: 'Leche entera pasteurizada, fermentos lácticos.',
    nutrients: { calories: 62, sugars: 4.7, saturatedFat: 2.0, sodium: 50, protein: 3.4, fiber: 0 },
  },
  {
    ean: '2000000000022',
    portionText: '1 pote (150 g)',
    portionSize: 150,
    name: 'Yogurt Protein Vainilla 0% Azúcar',
    brand: 'FitLácteos (demo)',
    categorySlug: 'yogures-y-lacteos',
    isLiquid: false,
    imageUrl: null,
    ingredientsRaw:
      'Leche descremada, concentrado de proteína de leche, saborizante idéntico al natural vainilla, estabilizante (carragenina), edulcorantes (sucralosa, acesulfamo K), fermentos lácticos. Contiene 18 mg de sucralosa y 12 mg de acesulfamo K por 100 g.',
    nutrients: { calories: 58, sugars: 3.9, saturatedFat: 0.1, sodium: 55, protein: 9.5, fiber: 0 },
  },
  {
    ean: '2000000000039',
    portionText: '1 pote (125 g)',
    portionSize: 125,
    name: 'Yogurt Batido Frutilla',
    brand: 'Lácteos del Sur (demo)',
    categorySlug: 'yogures-y-lacteos',
    isLiquid: false,
    imageUrl: null,
    ingredientsRaw:
      'Leche semidescremada, azúcar, preparado de frutilla (frutilla, azúcar, almidón modificado, saborizante idéntico al natural, colorante rojo allura AC), fermentos lácticos.',
    nutrients: { calories: 98, sugars: 13.2, saturatedFat: 1.2, sodium: 48, protein: 2.8, fiber: 0 },
  },
  {
    ean: '2000000000046',
    portionText: '1 vaso (200 ml)',
    portionSize: 200,
    name: 'Leche Descremada Sin Lactosa',
    brand: 'Lácteos del Sur (demo)',
    categorySlug: 'yogures-y-lacteos',
    isLiquid: true,
    imageUrl: null,
    ingredientsRaw: 'Leche descremada, enzima lactasa.',
    nutrients: { calories: 35, sugars: 4.9, saturatedFat: 0.1, sodium: 45, protein: 3.3, fiber: 0 },
  },

  // --- panes-de-molde --------------------------------------------------------
  {
    ean: '2000000000053',
    portionText: '2 rebanadas (50 g)',
    portionSize: 50,
    name: 'Pan Integral Masa Madre',
    brand: 'Horno Nativo (demo)',
    categorySlug: 'panes-de-molde',
    isLiquid: false,
    imageUrl: null,
    ingredientsRaw: 'Harina integral de trigo, agua, masa madre, sal.',
    nutrients: { calories: 240, sugars: 2.1, saturatedFat: 0.4, sodium: 380, protein: 9.0, fiber: 7.2 },
  },
  {
    ean: '2000000000060',
    portionText: '2 rebanadas (50 g)',
    portionSize: 50,
    name: 'Pan Blanco Cero Sellos',
    brand: 'PanFácil (demo)',
    categorySlug: 'panes-de-molde',
    isLiquid: false,
    imageUrl: null,
    ingredientsRaw:
      'Harina de trigo enriquecida, agua, gluten, levadura, aceite vegetal, sal, emulsionantes (mono y diglicéridos de ácidos grasos), espesante (carboximetilcelulosa), edulcorante (sucralosa), preservante (propionato de calcio).',
    nutrients: { calories: 255, sugars: 1.8, saturatedFat: 0.9, sodium: 390, protein: 8.0, fiber: 2.5 },
  },
  {
    ean: '2000000000077',
    portionText: '2 rebanadas (50 g)',
    portionSize: 50,
    name: 'Pan Multigrano Fibra+',
    brand: 'PanFácil (demo)',
    categorySlug: 'panes-de-molde',
    isLiquid: false,
    imageUrl: null,
    ingredientsRaw:
      'Harina integral de trigo, agua, mezcla de semillas (linaza, avena, maravilla), gluten, jarabe de maíz de alta fructosa, levadura, sal, aceite de canola.',
    nutrients: { calories: 245, sugars: 3.0, saturatedFat: 0.5, sodium: 250, protein: 10.0, fiber: 7.0 },
  },

  // --- cecinas-y-pavo --------------------------------------------------------
  {
    ean: '2000000000084',
    portionText: '2 láminas (30 g)',
    portionSize: 30,
    name: 'Pechuga de Pavo Cocida Light',
    brand: 'Cecinas Andinas (demo)',
    categorySlug: 'cecinas-y-pavo',
    isLiquid: false,
    imageUrl: null,
    ingredientsRaw:
      'Pechuga de pavo, agua, sal, proteína aislada de soya, almidón modificado, estabilizantes (polifosfatos de sodio, carragenina), dextrosa, saborizante idéntico al natural, preservante (nitrito de sodio), antioxidante (eritorbato de sodio).',
    nutrients: { calories: 98, sugars: 1.2, saturatedFat: 0.6, sodium: 395, protein: 17.0, fiber: 0 },
  },
  {
    ean: '2000000000091',
    portionText: '5 láminas (20 g)',
    portionSize: 20,
    name: 'Salame Artesanal Curado',
    brand: 'Charcutería del Valle (demo)',
    categorySlug: 'cecinas-y-pavo',
    isLiquid: false,
    imageUrl: null,
    ingredientsRaw: 'Carne de cerdo, tocino, sal, pimienta, ajo.',
    nutrients: { calories: 420, sugars: 0.5, saturatedFat: 14.0, sodium: 1700, protein: 25.0, fiber: 0 },
  },
  {
    ean: '2000000000107',
    portionText: '1 unidad (50 g)',
    portionSize: 50,
    name: 'Vienesas de Pollo y Cerdo',
    brand: 'Cecinas Andinas (demo)',
    categorySlug: 'cecinas-y-pavo',
    isLiquid: false,
    imageUrl: null,
    ingredientsRaw:
      'Carne de ave mecánicamente separada, agua, grasa de cerdo, proteína de soya, almidón modificado, sal, azúcar, estabilizante (tripolifosfato de sodio), saborizante artificial, glutamato monosódico, preservante (nitrito de sodio), colorante natural (carmín).',
    nutrients: { calories: 265, sugars: 2.0, saturatedFat: 7.5, sodium: 890, protein: 11.0, fiber: 0 },
  },
];
