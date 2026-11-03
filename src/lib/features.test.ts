import { describe, expect, it } from 'vitest';
import { SEED_PRODUCTS } from '../../scripts/seed-data';
import { guessCategorySlug } from './categories';
import type { HistoryEntry } from './db';
import { describeChange } from './history';
import { checkProfile, type ProfileInput } from './profiles';
import { evaluateProduct, type RawProductInput } from './scorer';
import { estimateExposure, parseSweetenerAmounts } from './sweeteners';
import { normalizeText } from './text';
import { extractEan, parseWebhook, verifySignature } from './whatsapp';

const base: RawProductInput = {
  name: 'Test',
  categorySlug: 'otros',
  isLiquid: false,
  ingredientsRaw: 'Agua.',
  nutrients: { calories: 0, sugars: 0, saturatedFat: 0, sodium: 0, protein: 0, fiber: 0 },
};
const ids = (ingredientsRaw: string) => evaluateProduct({ ...base, ingredientsRaw }).additives.map((a) => a.id).sort();

describe('diccionario v2', () => {
  it('detecta polioles, sacarina, dióxido de titanio, caramelo amónico y benzoatos', () => {
    expect(ids('Harina, edulcorante (maltitol), sal.')).toEqual(['polioles']);
    expect(ids('Agua, sacarina sódica.')).toEqual(['sacarina']);
    expect(ids('Azúcar, colorante (dióxido de titanio).')).toEqual(['dioxido-titanio']);
    expect(ids('Agua, colorante caramelo IV (INS 150d).')).toEqual(['caramelo-iv']);
    expect(ids('Agua, preservante (benzoato de sodio).')).toEqual(['benzoatos']);
  });

  it('no marca el caramelo genérico ni el sorbato', () => {
    expect(ids('Agua, colorante caramelo, sorbato de potasio.')).toEqual([]);
  });

  it('polioles + sucralosa activan el castigo por mezcla', () => {
    const e = evaluateProduct({ ...base, ingredientsRaw: 'Harina, maltitol, sucralosa.' });
    expect(e.multiSweetenerPenalty).toBe(true);
    expect(e.additivesScore).toBe(100 - 10 - 15 - 10);
  });

  it('el dióxido de titanio activa el tope de 49', () => {
    const e = evaluateProduct({ ...base, ingredientsRaw: 'Maní, dióxido de titanio.' });
    expect(e.finalScore).toBeLessThanOrEqual(49);
  });
});

describe('edulcorantes y modo niños', () => {
  it('lee la cantidad declarada del yogurt protein semilla', () => {
    const seed = SEED_PRODUCTS.find((p) => p.ean === '2000000000022')!;
    const e = evaluateProduct(seed);
    expect(e.kidsSweetenerWarning).toBe(true);
    expect(e.sweeteners).toEqual([
      { additiveId: 'sucralosa', mgPer100: 18, mgPerPortion: null },
      { additiveId: 'acesulfamo-k', mgPer100: 12, mgPerPortion: null },
    ]);
    // La declaración de mg no cuenta como ingrediente.
    expect(e.ingredientCount).toBe(6);
  });

  it('entiende "sucralosa 15 mg/porción" y "45 mg de aspartamo por 100 ml"', () => {
    const text = normalizeText('Contiene 45 mg de aspartamo por 100 ml. Sucralosa 15 mg/porción.');
    expect(parseSweetenerAmounts(text, ['aspartamo', 'sucralosa'])).toEqual([
      { additiveId: 'aspartamo', mgPer100: 45, mgPerPortion: null },
      { additiveId: 'sucralosa', mgPer100: null, mgPerPortion: 15 },
    ]);
  });

  it('estima % de IDA por peso', () => {
    // 150 g con 18 mg/100 g = 27 mg; IDA sucralosa 15 mg/kg × 18 kg = 270 mg → 10 %
    const est = estimateExposure({ additiveId: 'sucralosa', mgPer100: 18, mgPerPortion: null }, 150, 18, 150)!;
    expect(est.mgConsumed).toBe(27);
    expect(Math.round(est.percentOfAdi)).toBe(10);
    // Solo mg por porción: escala por el tamaño de porción.
    const est2 = estimateExposure({ additiveId: 'sacarina', mgPer100: null, mgPerPortion: 20 }, 100, 20, 200)!;
    expect(est2.mgConsumed).toBe(10);
  });

  it('stevia sí lleva la leyenda; los polioles no', () => {
    expect(evaluateProduct({ ...base, ingredientsRaw: 'Agua, stevia.' }).kidsSweetenerWarning).toBe(true);
    expect(evaluateProduct({ ...base, ingredientsRaw: 'Agua, maltitol.' }).kidsSweetenerWarning).toBe(false);
  });
});

describe('perfiles', () => {
  const input = (ingredientsRaw: string, extra: Partial<ProfileInput> = {}): ProfileInput => ({
    ingredientsRaw,
    dietaryTags: [],
    evaluation: evaluateProduct({ ...base, ingredientsRaw }),
    ...extra,
  });

  it('celíaco', () => {
    expect(checkProfile('celiaco', input('Harina de trigo, agua, sal.')).status).toBe('alerta');
    expect(checkProfile('celiaco', input('Maíz, sal. Puede contener trazas de trigo.')).status).toBe('alerta');
    expect(checkProfile('celiaco', input('Leche, fermentos.', { dietaryTags: ['Libre de Gluten'] })).status).toBe('ok');
    expect(checkProfile('celiaco', input('Leche, fermentos.')).status).toBe('revisar');
  });

  it('lactosa vs. APLV: deslactosada sirve para intolerancia pero no para alergia', () => {
    const deslactosada = input('Leche descremada deslactosada, lactasa.');
    expect(checkProfile('sin-lactosa', deslactosada).status).toBe('ok');
    expect(checkProfile('aplv', deslactosada).status).toBe('alerta');
    expect(checkProfile('aplv', input('Cacao, azúcar. Puede contener trazas de leche.')).status).toBe('alerta');
  });

  it('vegano', () => {
    expect(checkProfile('vegano', input('Harina, huevo, sal.')).status).toBe('alerta');
    expect(checkProfile('vegano', input('Jugo, colorante (E120).')).status).toBe('alerta');
    expect(checkProfile('vegano', input('Bebida de avena, vitamina D3.')).status).toBe('revisar');
    expect(checkProfile('vegano', input('Avena, agua, sal.')).status).toBe('ok');
  });

  it('niños: edulcorantes y colorantes azoicos son alerta', () => {
    const c = checkProfile('ninos', input('Agua, sucralosa, tartrazina.'));
    expect(c.status).toBe('alerta');
    expect(c.reasons).toHaveLength(2);
  });

  it('diabetes: polioles y azúcar añadido piden revisar', () => {
    expect(checkProfile('diabetes', input('Harina, azúcar, maltitol.')).status).toBe('revisar');
    expect(checkProfile('diabetes', input('Avena, agua.')).status).toBe('ok');
  });
});

describe('historial de reformulaciones', () => {
  it('describe aditivos, sellos y nutrientes que cambiaron, e ignora diferencias de redondeo', () => {
    const oldEv = evaluateProduct({ ...base, ingredientsRaw: 'Leche, azúcar, carragenina.', nutrients: { ...base.nutrients, sugars: 12, sodium: 100 } });
    const newEv = evaluateProduct({ ...base, ingredientsRaw: 'Leche, sucralosa.', nutrients: { ...base.nutrients, sugars: 4, sodium: 102 } });
    const entry: HistoryEntry = {
      id: 1,
      ean: '2000000000015',
      changedAt: '2026-11-01 10:00:00',
      oldScore: oldEv.finalScore,
      newScore: newEv.finalScore,
      oldIngredients: 'Leche, azúcar, carragenina.',
      newIngredients: 'Leche, sucralosa.',
      oldNutrients: { ...base.nutrients, sugars: 12, sodium: 100 },
      newNutrients: { ...base.nutrients, sugars: 4, sodium: 102 },
      oldEvaluation: oldEv,
      newEvaluation: newEv,
    };
    expect(describeChange(entry).map((l) => l.text)).toEqual([
      'Perdió el sello ALTO EN AZÚCARES',
      'Agregó Sucralosa',
      'Quitó Carragenina',
      'Azúcares: 12 → 4 g',
    ]);
  });
});

describe('categorías', () => {
  it('prioriza el nombre y la categoría más específica', () => {
    expect(guessCategorySlug('Pechuga de Pavo Cocida 125 g', ['Quesos y Fiambres', 'Fiambres', 'Pechuga de Pavo y Pollo'])).toBe('cecinas-y-pavo');
    expect(guessCategorySlug('Ideal Blanco XL', ['Panadería y Pastelería', 'Panadería envasada', 'Pan de Molde'])).toBe('panes-de-molde');
    expect(guessCategorySlug('Galletas Avena', ['Despensa', 'Galletas Dulces'], 'Galletas Dulces')).toBe('galletas-dulces');
  });
});

describe('whatsapp', () => {
  it('extrae mensajes de texto e imagen del webhook', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'm1', from: '56911111111', type: 'text', text: { body: '7802920010588' } },
                  { id: 'm2', from: '56911111111', type: 'image', image: { id: 'img1', caption: '7802920010588 yogurt' } },
                ],
                statuses: [{ id: 's1' }],
              },
            },
          ],
        },
      ],
    };
    expect(parseWebhook(payload)).toEqual([
      { id: 'm1', from: '56911111111', type: 'text', text: '7802920010588' },
      { id: 'm2', from: '56911111111', type: 'image', imageId: 'img1', caption: '7802920010588 yogurt' },
    ]);
  });

  it('extractEan valida el dígito verificador', () => {
    expect(extractEan('mira este 780 2920 010588 porfa')).toBe('7802920010588');
    expect(extractEan('1234567890123')).toBeNull();
  });

  it('verifySignature valida HMAC-SHA256', async () => {
    const body = '{"a":1}';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secreto'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
    const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await verifySignature('secreto', body, `sha256=${hex}`)).toBe(true);
    expect(await verifySignature('otro', body, `sha256=${hex}`)).toBe(false);
    expect(await verifySignature('secreto', body, null)).toBe(false);
  });
});
