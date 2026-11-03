import { describe, expect, it } from 'vitest';
import { catalogParams, pairSuggestions, parseCatalogQuery, type ProductSummary } from './catalog';
import {
  MAX_COMPARE,
  mixedCategories,
  parseQueue,
  queueVersusPath,
  removeItem,
  setSlot,
  toggleItem,
  type CompareItem,
} from './compare';
import { catalogWhere } from './db';
import { productCardHtml } from './product-html';

const summary = (over: Partial<ProductSummary>): ProductSummary => ({
  ean: '7800000000001',
  slug: 'producto',
  name: 'Producto',
  brand: 'Marca',
  categorySlug: 'yogures-y-lacteos',
  finalScore: 50,
  novaGroup: 4,
  sealsCount: 0,
  seals: [],
  isFakeHealthy: false,
  additivesCount: 0,
  imageUrl: null,
  ...over,
});

const item = (ean: string, categorySlug = 'yogures-y-lacteos'): CompareItem => ({
  ean,
  slug: `p-${ean}`,
  name: `Producto ${ean}`,
  brand: 'Marca',
  categorySlug,
  finalScore: 60,
});

describe('parseCatalogQuery', () => {
  it('aplica valores por defecto y acota límites', () => {
    expect(parseCatalogQuery(new URLSearchParams())).toEqual({
      q: '',
      category: '',
      filters: [],
      sort: 'score_desc',
      limit: 24,
      offset: 0,
    });
    const q = parseCatalogQuery(new URLSearchParams('limit=500&offset=-3&sort=raro&category=../etc'));
    expect(q.limit).toBe(60);
    expect(q.offset).toBe(0);
    expect(q.sort).toBe('score_desc');
    expect(q.category).toBe('');
  });

  it('acepta varios filtros, ignora "all" y desconocidos', () => {
    const q = parseCatalogQuery(new URLSearchParams('filter=top,all,no_seals,top,xyz&sort=additives'));
    expect(q.filters).toEqual(['top', 'no_seals']);
    expect(q.sort).toBe('additives');
  });

  it('catalogParams omite los valores por defecto (ida y vuelta)', () => {
    const q = parseCatalogQuery(new URLSearchParams('q=yogur&category=panes-de-molde&filter=real_food&sort=score_asc'));
    expect(catalogParams({ ...q, offset: 0 }).toString()).toBe('q=yogur&category=panes-de-molde&filter=real_food&sort=score_asc');
    expect(catalogParams({ sort: 'score_desc', limit: 24, offset: 0 }).toString()).toBe('');
  });
});

describe('catalogWhere', () => {
  it('busca cada palabra sin tildes en nombre y marca', () => {
    const { where, binds } = catalogWhere({ q: 'Azúcar  Colún', category: '', filters: [] });
    expect(binds).toEqual(['%azucar%', '%colun%']);
    expect(where.match(/LIKE \?/g)).toHaveLength(2);
    expect(where).toContain("replace(");
    expect(where.startsWith('verified = 1')).toBe(true);
  });

  it('un texto numérico de 8 a 14 dígitos busca también el EAN exacto', () => {
    const { where, binds } = catalogWhere({ q: '7802900001018', category: '', filters: [] });
    expect(where).toContain('(ean = ? OR (');
    expect(binds).toEqual(['7802900001018', '%7802900001018%']);
  });

  it('combina categoría y filtros, sin comodines del usuario', () => {
    const { where, binds } = catalogWhere({ q: '100%_', category: 'cecinas-y-pavo', filters: ['top', 'no_seals', 'fake_healthy', 'real_food'] });
    expect(binds).toEqual(['%100%', 'cecinas-y-pavo']);
    expect(where).toContain('final_score >= 75');
    expect(where).toContain('seals_count = 0');
    expect(where).toContain('is_fake_healthy = 1');
    expect(where).toContain("json_extract(evaluation_json, '$.novaGroup') <= 2");
  });
});

describe('pairSuggestions', () => {
  it('cruza el mejor con la peor trampa de la misma categoría, repartiendo por categoría', () => {
    const best = [
      summary({ ean: 'a1', categorySlug: 'a', finalScore: 90 }),
      summary({ ean: 'a2', categorySlug: 'a', finalScore: 85 }),
      summary({ ean: 'b1', categorySlug: 'b', finalScore: 80 }),
    ];
    const traps = [
      summary({ ean: 'ta1', categorySlug: 'a', finalScore: 20, isFakeHealthy: true }),
      summary({ ean: 'ta2', categorySlug: 'a', finalScore: 30, isFakeHealthy: true }),
      summary({ ean: 'tb1', categorySlug: 'b', finalScore: 25, isFakeHealthy: true }),
    ];
    const pairs = pairSuggestions(best, traps).map((p) => `${p.best.ean}-${p.trap.ean}`);
    expect(pairs).toEqual(['a1-ta1', 'b1-tb1', 'a2-ta2']);
  });

  it('descarta pares sin trampa, con el mismo producto o donde la trampa no pierde', () => {
    const best = [summary({ ean: 'x', categorySlug: 'a', finalScore: 40 }), summary({ ean: 'y', categorySlug: 'c', finalScore: 90 })];
    const traps = [summary({ ean: 't', categorySlug: 'a', finalScore: 45 })];
    expect(pairSuggestions(best, traps)).toEqual([]);
  });
});

describe('cola de comparación', () => {
  it('agrega hasta 2, quita si ya está y reemplaza el segundo con la cola llena', () => {
    let q = toggleItem([], item('1'));
    q = toggleItem(q, item('2'));
    expect(q.map((i) => i.ean)).toEqual(['1', '2']);
    q = toggleItem(q, item('3'));
    expect(q.map((i) => i.ean)).toEqual(['1', '3']);
    expect(q).toHaveLength(MAX_COMPARE);
    q = toggleItem(q, item('1'));
    expect(q.map((i) => i.ean)).toEqual(['3']);
  });

  it('setSlot respeta la posición y no duplica', () => {
    const q = [item('1'), item('2')];
    expect(setSlot(q, 0, item('3')).map((i) => i.ean)).toEqual(['3', '2']);
    expect(setSlot(q, 1, item('3')).map((i) => i.ean)).toEqual(['1', '3']);
    expect(setSlot(q, 0, item('2')).map((i) => i.ean)).toEqual(['2']);
    expect(setSlot([], 1, item('9')).map((i) => i.ean)).toEqual(['9']);
    expect(removeItem(q, '1').map((i) => i.ean)).toEqual(['2']);
  });

  it('parseQueue tolera basura, duplicados y ítems incompletos', () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue('{no json')).toEqual([]);
    expect(parseQueue('{"a":1}')).toEqual([]);
    const raw = JSON.stringify([item('1'), { ean: '2', slug: 'x' }, item('1'), item('3'), item('4')]);
    expect(parseQueue(raw).map((i) => i.ean)).toEqual(['1', '3']);
  });

  it('arma la URL canónica en orden alfabético y detecta categorías distintas', () => {
    const b = { ...item('2'), slug: 'b-yogur' };
    const a = { ...item('1', 'panes-de-molde'), slug: 'a-pan' };
    expect(queueVersusPath([b, a])).toBe('/comparar/a-pan-vs-b-yogur');
    expect(queueVersusPath([b])).toBeNull();
    expect(mixedCategories([b, a])).toBe(true);
    expect(mixedCategories([b, item('3')])).toBe(false);
  });
});

describe('productCardHtml', () => {
  it('escapa los textos y lleva el botón + Comparar con su JSON', () => {
    const html = productCardHtml(summary({ name: 'Pan "Molde" <b>', brand: 'O\'Higgins', slug: 'pan-molde', isFakeHealthy: true }));
    expect(html).toContain('Pan &quot;Molde&quot; &lt;b&gt;');
    expect(html).toContain('O&#39;Higgins');
    expect(html).not.toContain('<b>');
    expect(html).toContain('href="/producto/pan-molde"');
    expect(html).toContain('Falso sin sellos');
    const attr = /data-compare-product="([^"]+)"/.exec(html)?.[1] ?? '';
    const decoded = attr.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(JSON.parse(decoded)).toMatchObject({ slug: 'pan-molde', name: 'Pan "Molde" <b>' });
  });

  it('puede omitir el botón de comparar', () => {
    expect(productCardHtml(summary({}), { compare: false })).not.toContain('data-compare-product');
  });
});
