/** Forma pública y estable de un producto en la API B2B (v1). No expone campos internos. */
import { DATA_SOURCE_LABELS, type Offer, type Product } from './db';
import { METHODOLOGY_VERSION } from './scorer';
import { SITE_URL } from './site';

export function toB2BProduct(p: Product, offers: Offer[]) {
  const ev = p.evaluation;
  return {
    ean: p.ean,
    name: p.name,
    brand: p.brand,
    category: p.categorySlug,
    url: `${SITE_URL}/producto/${p.slug}`,
    verified: p.verified,
    score: p.finalScore,
    pillars: { nutrition: ev.nutritionScore, nova: ev.novaScore, additives: ev.additivesScore },
    novaGroup: ev.novaGroup,
    minsalSeals: ev.minsalSeals,
    borderlineWarnings: ev.borderlineWarnings,
    isFakeHealthy: p.isFakeHealthy,
    hardCapReason: ev.hardCapReason,
    additives: ev.additives.map((a) => ({ id: a.id, name: a.name, code: a.code, level: a.level })),
    kidsSweetenerWarning: ev.kidsSweetenerWarning,
    nutrientsPer100: p.nutrients,
    basis: ev.basis,
    ingredients: p.ingredientsRaw,
    dataSource: { id: p.dataSource, label: DATA_SOURCE_LABELS[p.dataSource] },
    updatedAt: p.updatedAt,
    offers: offers.map((o) => ({
      store: o.store,
      price: o.price,
      listPrice: o.listPrice,
      pricePerUnit: o.ppumPrice,
      unit: o.ppumUnit,
      available: o.available,
      url: o.url,
      updatedAt: o.updatedAt,
    })),
    methodologyVersion: METHODOLOGY_VERSION,
  };
}
