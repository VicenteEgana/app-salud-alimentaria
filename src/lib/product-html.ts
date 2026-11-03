/**
 * Render en el navegador (escáner, buscador, lista, perfiles) de productos que llegan por la API.
 * Funciona igual en la web y en la app de Capacitor, donde no hay SSR.
 */
import { categoryName } from './categories';
import type { ProductSummary, VersusSuggestion } from './catalog';
import type { OfflineItem } from './client-store';
import { compareAttr, type CompareItem } from './compare';
import type { Offer, Product } from './db';
import { PROFILES, checkProfile, type ProfileId, type ProfileInput, type ProfileStatus } from './profiles';
import { ADDITIVE_LEVEL_LABELS, NOVA_LABELS, getAdditiveDefinition, type MinsalSeal } from './scorer';
import { href } from './site';
import { cartUrl } from './stores/cencosud';
import { KIDS_WARNING_TEXT } from './sweeteners';
import { escapeHtml as e } from './text';
import { ADDITIVE_LEVEL_STYLE, NOVA_BADGE, clp, perUnit, sealNutrient, tierStyle } from './ui';
import { versusPath } from './versus';

export function scoreCircle(score: number, sizeClass: string, insetClass: string): string {
  const { color } = tierStyle(score);
  return `<div class="relative shrink-0 rounded-full ${sizeClass}" style="background: conic-gradient(${color} ${score}%, #e7e5e4 0)" role="img" aria-label="Puntaje ${score} de 100">
    <div class="absolute ${insetClass} flex items-center justify-center rounded-full bg-white font-bold tabular-nums" style="color:${color}">${score}</div>
  </div>`;
}

/** Octágonos negros (o "0 sellos MINSAL" si no tiene). */
function sealsHtml(seals: MinsalSeal[]): string {
  if (seals.length === 0) {
    return '<span class="inline-flex items-center rounded-full border border-stone-300 px-2 py-0.5 text-xs font-medium text-stone-600">0 sellos MINSAL</span>';
  }
  return `<ul class="flex flex-wrap gap-1" aria-label="${seals.length} sellos MINSAL">${seals
    .map(
      (s) =>
        `<li class="seal-octagon flex h-10 w-10 flex-col items-center justify-center bg-black text-center text-[6px] leading-tight font-bold text-white" title="${e(s)}"><span>ALTO EN</span><span>${e(sealNutrient(s))}</span></li>`,
    )
    .join('')}</ul>`;
}

const FAKE_BADGE = '<span class="rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white">Falso sin sellos</span>';

// ---------------------------------------------------------------------------
// Tarjeta de producto y comparación (la misma en SSR, vía ProductCard.astro, y en el navegador)
// ---------------------------------------------------------------------------

/**
 * Botón "+ Comparar". La barra de comparación (ComparisonDock) escucha los clics de cualquier
 * [data-compare-product] de la página y sincroniza aria-pressed y el texto.
 */
export function compareButtonHtml(p: CompareItem, size: 'sm' | 'lg' = 'sm'): string {
  const cls =
    size === 'sm'
      ? 'relative z-10 mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs'
      : 'flex items-center justify-center rounded-2xl px-4 py-3 text-sm';
  return `<button type="button" data-compare-product="${compareAttr(p)}" aria-pressed="false" class="${cls} border border-emerald-600 bg-white font-semibold text-emerald-700 transition hover:bg-emerald-50 aria-pressed:bg-emerald-600 aria-pressed:text-white">+ Comparar</button>`;
}

export interface CardOptions {
  /** Posición en un ranking (1, 2, 3…). */
  rank?: number;
  /** Precio a mostrar (ej. la oferta de Jumbo). */
  offer?: Offer;
  /** Muestra el botón "+ Comparar" (por defecto sí). */
  compare?: boolean;
}

/** Tarjeta de producto: el nombre enlaza a la ficha y cubre la tarjeta; el botón de comparar queda encima. */
export function productCardHtml(p: ProductSummary, opts: CardOptions = {}): string {
  const image = p.imageUrl
    ? `<img src="${e(p.imageUrl)}" alt="" loading="lazy" decoding="async" class="h-14 w-14 shrink-0 rounded-xl bg-stone-100 object-contain" />`
    : `<div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-lg font-bold text-stone-400" aria-hidden="true">${e(p.name.charAt(0))}</div>`;
  const price = opts.offer
    ? [clp(opts.offer.price), perUnit(opts.offer.ppumPrice, opts.offer.ppumUnit)].filter(Boolean).join(' · ')
    : '';
  return `<article class="group relative flex h-full min-w-0 items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm transition hover:border-stone-300 hover:shadow-md">
    ${opts.rank !== undefined ? `<span class="w-5 shrink-0 text-center text-sm font-semibold text-stone-400 tabular-nums">${opts.rank}</span>` : ''}
    ${image}
    <div class="min-w-0 flex-1">
      <p class="truncate text-xs font-medium tracking-wide text-stone-500 uppercase">${e(p.brand)}</p>
      <h3 class="line-clamp-2 leading-snug font-semibold text-stone-900"><a href="${e(href(`/producto/${p.slug}`))}" class="after:absolute after:inset-0 after:rounded-2xl group-hover:underline">${e(p.name)}</a></h3>
      <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${NOVA_BADGE[p.novaGroup]}" title="${e(NOVA_LABELS[p.novaGroup])}">NOVA ${p.novaGroup}</span>
        ${p.sealsCount === 0 ? '<span class="rounded-full border border-stone-300 px-2 py-0.5 text-[11px] font-medium text-stone-600">0 sellos</span>' : ''}
        ${p.isFakeHealthy ? FAKE_BADGE : ''}
      </div>
      ${p.seals.length ? `<div class="mt-1.5">${sealsHtml(p.seals)}</div>` : ''}
      ${price ? `<p class="mt-1 text-xs text-stone-600 tabular-nums">${e(price)}</p>` : ''}
      ${opts.compare === false ? '' : compareButtonHtml(p)}
    </div>
    ${scoreCircle(p.finalScore, 'h-16 w-16 text-xl', 'inset-[5px]')}
  </article>`;
}

/** Tarjetas grises mientras carga el catálogo. */
export function skeletonCardsHtml(count: number): string {
  const card = `<div class="flex animate-pulse items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3" aria-hidden="true">
    <div class="h-14 w-14 shrink-0 rounded-xl bg-stone-200"></div>
    <div class="min-w-0 flex-1 space-y-2"><div class="h-2.5 w-1/3 rounded bg-stone-200"></div><div class="h-3.5 w-4/5 rounded bg-stone-200"></div><div class="h-3 w-1/2 rounded bg-stone-200"></div></div>
    <div class="h-16 w-16 shrink-0 rounded-full bg-stone-200"></div>
  </div>`;
  return card.repeat(count);
}

/** Comparativa sugerida "lista para un clic". */
export function versusSuggestionHtml(s: VersusSuggestion): string {
  return `<a href="${e(href(versusPath(s.best.slug, s.trap.slug)))}" class="flex h-full items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3 hover:border-emerald-300 hover:shadow-sm">
    ${scoreCircle(s.best.finalScore, 'h-11 w-11 text-sm', 'inset-[4px]')}
    <span class="min-w-0 flex-1 text-sm">
      <span class="block text-[11px] font-semibold tracking-wide text-stone-400 uppercase">${e(categoryName(s.categorySlug))}</span>
      <span class="line-clamp-1 font-semibold">${e(s.best.name)}</span>
      <span class="text-[11px] font-black text-stone-400">VS</span>
      <span class="line-clamp-1 font-semibold">${e(s.trap.name)}</span>
    </span>
    ${scoreCircle(s.trap.finalScore, 'h-11 w-11 text-sm', 'inset-[4px]')}
  </a>`;
}

/** Fila compacta para resultados de búsqueda. */
export function productListItemHtml(product: Product): string {
  return `<a href="${e(href(`/producto/${product.slug}`))}" class="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-stone-50">
    ${scoreCircle(product.finalScore, 'h-10 w-10 text-sm', 'inset-[4px]')}
    <div class="min-w-0 flex-1">
      <p class="truncate text-[11px] font-medium tracking-wide text-stone-500 uppercase">${e(product.brand)}</p>
      <p class="truncate font-semibold">${e(product.name)}</p>
    </div>
    ${product.isFakeHealthy ? '<span class="shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white">Falso sin sellos</span>' : ''}
  </a>`;
}

// ---------------------------------------------------------------------------
// Perfiles personales
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<ProfileStatus, { cls: string; label: string }> = {
  ok: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', label: 'Sin alertas' },
  revisar: { cls: 'border-amber-200 bg-amber-50 text-amber-900', label: 'Revisar' },
  alerta: { cls: 'border-red-200 bg-red-50 text-red-900', label: 'Alerta' },
};

/** Resultado de los perfiles activos del usuario, o una invitación a configurarlos. */
export function profileChecksHtml(input: ProfileInput, profiles: ProfileId[]): string {
  if (profiles.length === 0) {
    return `<a href="${e(href('/perfil'))}" class="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-stone-300 px-4 py-3 text-sm text-stone-600 hover:bg-stone-50">
      <span>¿Celíaco, vegano, sin lactosa o compras para niños? Activa tu perfil y te avisamos.</span><span aria-hidden="true">→</span></a>`;
  }
  const items = profiles.map((id) => {
    const c = checkProfile(id, input);
    const st = STATUS_STYLE[c.status];
    return `<li class="rounded-2xl border px-3 py-2.5 text-sm ${st.cls}">
      <p class="font-semibold">${e(c.profile.name)} · ${st.label}</p>
      <p class="mt-0.5 opacity-90">${c.reasons.map(e).join(' · ')}</p></li>`;
  });
  return `<ul class="space-y-2">${items.join('')}</ul>
    <p class="mt-2 text-xs text-stone-500">Orientativo, según los ingredientes publicados. Revisa siempre el envase. Tu perfil se guarda solo en este dispositivo.</p>`;
}

export const profileInput = (p: Product): ProfileInput => ({
  ingredientsRaw: p.ingredientsRaw,
  dietaryTags: p.dietaryTags,
  evaluation: p.evaluation,
});

// ---------------------------------------------------------------------------
// Ofertas y carro
// ---------------------------------------------------------------------------

const STORE_NAMES: Record<string, string> = { jumbo: 'Jumbo', 'santa-isabel': 'Santa Isabel' };

export function offersHtml(offers: Offer[]): string {
  if (offers.length === 0) return '';
  return `<ul class="space-y-2">${offers
    .map((o) => {
      const discount = o.listPrice && o.listPrice > o.price ? `<span class="text-xs text-stone-400 line-through">${clp(o.listPrice)}</span>` : '';
      return `<li class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-stone-200 px-3 py-2.5">
        <div><p class="text-sm font-semibold">${e(STORE_NAMES[o.store] ?? o.store)} · ${clp(o.price)} ${discount}</p>
        <p class="text-xs text-stone-500">${e(perUnit(o.ppumPrice, o.ppumUnit))}${o.available ? '' : ' · sin stock'}</p></div>
        ${
          o.available && o.store === 'jumbo'
            ? `<a href="${e(cartUrl('jumbo', [{ sku: o.sku }]))}" target="_blank" rel="noopener" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">Agregar al carro</a>`
            : `<a href="${e(o.url)}" target="_blank" rel="noopener" class="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold">Ver en tienda</a>`
        }</li>`;
    })
    .join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Resultado del escáner
// ---------------------------------------------------------------------------

export type ScanStatus = 'database' | 'catalog' | 'pending' | 'verified-by-consensus' | 'already-verified';

const STATUS_NOTE: Partial<Record<ScanStatus, string>> = {
  catalog: 'Recién incorporado desde el catálogo del supermercado.',
  pending: 'Leído por IA desde tu foto. Queda pendiente de verificación por el equipo.',
  'verified-by-consensus': '¡Tu foto coincidió con otro escaneo! El producto quedó verificado.',
};

export function scanResultHtml(product: Product, status: ScanStatus, opts: { offers?: Offer[]; profiles: ProfileId[]; saved: boolean }): string {
  const ev = product.evaluation;
  const tier = tierStyle(product.finalScore);
  const note = STATUS_NOTE[status] ?? (product.verified ? '' : STATUS_NOTE.pending);

  const additives = ev.additives.length
    ? `<ul class="space-y-1.5">${[...ev.additives]
        .sort((a, b) => b.level - a.level)
        .map(
          (a) =>
            `<li class="rounded-xl border px-3 py-2 text-sm ${ADDITIVE_LEVEL_STYLE[a.level]}"><span class="font-semibold">${e(a.name)}</span> <span class="opacity-75">· ${ADDITIVE_LEVEL_LABELS[a.level]} · −${a.penalty}</span></li>`,
        )
        .join('')}</ul>`
    : '<p class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">Sin aditivos de riesgo</p>';

  return `<article class="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
    ${note ? `<p class="mb-3 rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-700">${e(note)}</p>` : ''}
    <div class="flex items-start gap-4">
      ${scoreCircle(product.finalScore, 'h-20 w-20 text-2xl', 'inset-[6px]')}
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium tracking-wide text-stone-500 uppercase">${e(product.brand)}</p>
        <h2 class="text-lg leading-snug font-bold">${e(product.name)}</h2>
        <p class="mt-0.5 text-sm font-semibold ${tier.text}">${tier.label}</p>
      </div>
    </div>
    ${
      product.isFakeHealthy
        ? `<p class="mt-3 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white">Falso sin sellos: no tiene sellos MINSAL, pero es ultraprocesado y contiene aditivos o edulcorantes. <a class="underline" href="${e(href('/metodologia'))}#falso-sin-sellos">¿Qué significa?</a></p>`
        : ''
    }
    ${ev.kidsSweetenerWarning ? `<p class="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">👶 Le aplicaría la leyenda propuesta por el MINSAL: <strong>"${KIDS_WARNING_TEXT}"</strong>.</p>` : ''}
    ${ev.hardCapReason ? `<p class="mt-3 text-xs text-stone-600">${e(ev.hardCapReason)}</p>` : ''}
    <div class="mt-4 flex flex-wrap items-center gap-2">
      ${sealsHtml(ev.minsalSeals)}
      <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${NOVA_BADGE[ev.novaGroup]}">NOVA ${ev.novaGroup} · ${NOVA_LABELS[ev.novaGroup]}</span>
    </div>
    ${ev.borderlineWarnings.map((w) => `<p class="mt-2 text-sm text-amber-700">⚠ ${e(w)}</p>`).join('')}
    <div class="mt-4">${additives}</div>
    <div class="mt-4">${profileChecksHtml(profileInput(product), opts.profiles)}</div>
    ${opts.offers?.length ? `<div class="mt-4">${offersHtml(opts.offers)}</div>` : ''}
    <div class="mt-4 grid grid-cols-2 gap-2">
      <button type="button" data-save-ean="${e(product.ean)}" class="rounded-2xl border border-stone-300 px-4 py-3 text-sm font-semibold">${opts.saved ? '✓ En mi lista' : '+ Mi lista'}</button>
      ${compareButtonHtml(product, 'lg')}
      <a href="${e(href(`/producto/${product.slug}`))}" class="col-span-2 flex items-center justify-center rounded-2xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white">Radiografía completa</a>
    </div>
  </article>`;
}

/** Resultado mínimo desde el paquete sin conexión. */
export function offlineResultHtml(item: OfflineItem, packDate: string): string {
  const tier = tierStyle(item.sc);
  const additiveNames = item.a.map((id) => getAdditiveDefinition(id)?.name ?? id);
  return `<article class="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
    <p class="mb-3 rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-700">Sin conexión: datos guardados en este dispositivo el ${e(new Date(packDate).toLocaleDateString('es-CL'))}.</p>
    <div class="flex items-start gap-4">
      ${scoreCircle(item.sc, 'h-20 w-20 text-2xl', 'inset-[6px]')}
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium tracking-wide text-stone-500 uppercase">${e(item.b)}</p>
        <h2 class="text-lg leading-snug font-bold">${e(item.n)}</h2>
        <p class="mt-0.5 text-sm font-semibold ${tier.text}">${tier.label}</p>
      </div>
    </div>
    ${item.f ? '<p class="mt-3 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white">Falso sin sellos</p>' : ''}
    <p class="mt-3 text-sm text-stone-700">${item.se} sellos MINSAL · NOVA ${item.nv}</p>
    ${additiveNames.length ? `<p class="mt-1 text-sm text-stone-700">Aditivos de riesgo: ${additiveNames.map(e).join(', ')}</p>` : ''}
  </article>`;
}

export { PROFILES };
