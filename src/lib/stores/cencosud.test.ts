import { describe, expect, it } from 'vitest';
import {
  cartUrl,
  parseCatalogResponse,
  parseClNumber,
  parsePortionSize,
  parseProductPage,
} from './cencosud';

/** Ficha mínima con la misma estructura que el frontend Next.js de Jumbo (payload RSC + JSON-LD). */
function fixtureHtml(payload: string, jsonLd: unknown[]): string {
  const push = (s: string) => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`;
  const half = Math.floor(payload.length / 2);
  return `<html><head>${jsonLd
    .map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`)
    .join('')}</head><body>${push(payload.slice(0, half))}${push(payload.slice(half))}</body></html>`;
}

const PAYLOAD =
  '"items":[{"skuId":"125702","ean":"7802920010588","name":"Yogurt Natural 120 g","price":370,"listPrice":420,"images":"$16b","stock":true,"ppumPrice":3217,"ppumListPrice":3217,"ppumMeasurementUnit":"kg"}],' +
  '"specifications":[{"key":"alimentaryConditions","value":["Libre de Gluten"]},' +
  '{"key":"ingredients","value":["leche fluida natural entera, vitamina d3 (origen animal), cepas de yoghurt"]},' +
  '{"key":"portion","value":["1 Vaso (120 g)"]},{"key":"Contenido Neto","value":["120 g"]},' +
  '{"key":"Energía (kCal)","value":["85 / 102"]},{"key":"Proteínas (g)","value":["3,30 / 3,96"]},' +
  '{"key":"Grasas Saturadas (g)","value":["3,58 / 4,30"]},{"key":"Azúcares totales (g)","value":["3,5 / 4,2"]},' +
  '{"key":"Sodio (mg)","value":["45 / 54"]}],' +
  '"table":[{"key":"Energía (kCal)","gramsMilliliters":"85","onePortion":"102"},{"key":"Fibra dietética total (g)","gramsMilliliters":"0,5","onePortion":"0,6"}]';

const LD = [
  { '@type': 'Product', name: 'Yogurt Natural 120 g', gtin: '7802920010588', brand: { name: 'Colun' }, image: 'https://img/1.jpg' },
  {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Inicio' }, { name: 'Lácteos' }, { name: 'Yoghurt Natural' }, { name: 'Yogurt Natural 120 g' }],
  },
];

describe('parseProductPage', () => {
  const p = parseProductPage('jumbo', 'yogurt-natural-120g', fixtureHtml(PAYLOAD, LD))!;

  it('lee EAN, SKU, precio y precio por kilo del ítem', () => {
    expect(p.ean).toBe('7802920010588');
    expect(p.sku).toBe('125702');
    expect(p.price).toBe(370);
    expect(p.listPrice).toBe(420);
    expect(p.ppumPrice).toBe(3217);
    expect(p.ppumUnit).toBe('kg');
    expect(p.available).toBe(true);
  });

  it('toma la columna por 100 g (antes de la barra) y la fibra del formato estructurado', () => {
    expect(p.nutrients).toEqual({ calories: 85, protein: 3.3, saturatedFat: 3.58, sugars: 3.5, sodium: 45, fiber: 0.5 });
  });

  it('lee ingredientes, porción, condiciones alimentarias, marca y categorías', () => {
    expect(p.ingredientsRaw).toContain('cepas de yoghurt');
    expect(p.portionSize).toBe(120);
    expect(p.isLiquid).toBe(false);
    expect(p.dietaryTags).toEqual(['Libre de Gluten']);
    expect(p.brand).toBe('Colun');
    expect(p.categoryNames).toEqual(['Lácteos', 'Yoghurt Natural']);
    expect(p.url).toBe('https://www.jumbo.cl/yogurt-natural-120g/p');
  });

  it('devuelve null si la ficha no tiene EAN', () => {
    expect(parseProductPage('jumbo', 'x', '<html></html>')).toBeNull();
  });
});

describe('helpers', () => {
  it('parseClNumber entiende formato chileno', () => {
    expect(parseClNumber('3,58')).toBe(3.58);
    expect(parseClNumber('1.234,5')).toBe(1234.5);
    expect(parseClNumber('<0,5')).toBe(0.5);
    expect(parseClNumber('Tr')).toBe(0);
    expect(parseClNumber('')).toBeNull();
  });

  it('parsePortionSize', () => {
    expect(parsePortionSize('2 rebanadas (50g)')).toBe(50);
    expect(parsePortionSize('1 vaso (200 ml)')).toBe(200);
    expect(parsePortionSize(null)).toBeNull();
  });

  it('cartUrl arma el link del carro con varios SKU y descarta los inválidos', () => {
    expect(cartUrl('jumbo', [{ sku: '125702', qty: 2 }, { sku: '9', qty: 1 }, { sku: 'x' }])).toBe(
      'https://www.jumbo.cl/?sku=125702,9&qty=2,1',
    );
  });

  it('parseCatalogResponse', () => {
    const hits = parseCatalogResponse('jumbo', {
      products: [
        {
          slug: 'yoghurt-x/1',
          brand: 'Colun',
          categoryNames: ['Lácteos'],
          items: [{ skuId: '1', name: 'Yoghurt X', price: 500, listPrice: 600, ppumPrice: 4000, ppumMeasurementUnit: 'kg', images: ['https://i'], stock: true }],
        },
        { slug: 'sin-items' },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ slug: 'yoghurt-x/1', sku: '1', price: 500, ppumPrice: 4000, imageUrl: 'https://i' });
  });
});
