/**
 * Buscador predictivo de productos (combobox accesible): selectores A/B de /comparar, "Cambiar" en el
 * versus y el buscador de la barra de comparación. Consulta /api/products/search con debounce.
 */
import { categoryName } from './categories';
import type { CatalogQuery, ProductSummary } from './catalog';
import { fetchCatalog } from './catalog-client';
import { scoreCircle } from './product-html';
import { escapeHtml as e } from './text';

export interface PickerContext {
  /** Categoría para las sugerencias al enfocar sin texto (la del otro producto). */
  category?: string;
  /** EAN que no se ofrecen (los ya elegidos). */
  excludeEans?: string[];
}

export interface PickerOptions {
  input: HTMLInputElement;
  /** Contenedor de las opciones (un <ul>). */
  list: HTMLElement;
  onPick: (item: ProductSummary) => void;
  context?: () => PickerContext;
  limit?: number;
  /** La lista queda siempre visible (dentro de un diálogo) en vez de cerrarse al perder el foco. */
  inline?: boolean;
}

export interface PickerHandle {
  focus: () => void;
  close: () => void;
  reload: () => void;
}

const DEBOUNCE_MS = 250;
let uid = 0;

const SKELETON = Array.from(
  { length: 3 },
  () => `<li role="presentation" class="flex animate-pulse items-center gap-3 px-3 py-2" aria-hidden="true">
    <div class="h-9 w-9 shrink-0 rounded-full bg-stone-200"></div>
    <div class="flex-1 space-y-1.5"><div class="h-2.5 w-1/3 rounded bg-stone-200"></div><div class="h-3 w-3/4 rounded bg-stone-200"></div></div></li>`,
).join('');

const note = (text: string) => `<li role="presentation" class="px-3 py-3 text-sm text-stone-500">${text}</li>`;

function optionHtml(p: ProductSummary, id: string, index: number): string {
  return `<li role="option" id="${id}" data-index="${index}" aria-selected="false" class="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-stone-50 aria-selected:bg-emerald-50">
    ${scoreCircle(p.finalScore, 'h-9 w-9 text-xs', 'inset-[3px]')}
    <div class="min-w-0 flex-1">
      <p class="truncate text-[11px] font-medium tracking-wide text-stone-500 uppercase">${e(p.brand)} · ${e(categoryName(p.categorySlug))}</p>
      <p class="line-clamp-2 text-sm leading-snug font-semibold text-stone-900">${e(p.name)}</p>
    </div>
    ${p.isFakeHealthy ? '<span class="shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white">Falso sin sellos</span>' : ''}
  </li>`;
}

export function attachProductPicker(opts: PickerOptions): PickerHandle {
  const { input, list } = opts;
  const limit = opts.limit ?? 8;
  const listId = list.id || `product-picker-${++uid}`;
  list.id = listId;
  list.setAttribute('role', 'listbox');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('aria-expanded', 'false');
  input.autocomplete = 'off';

  let items: ProductSummary[] = [];
  let active = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const show = (html: string) => {
    list.innerHTML = html;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const close = () => {
    clearTimeout(timer);
    setActive(-1);
    if (opts.inline) return;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };

  function setActive(index: number) {
    active = index;
    list.querySelectorAll<HTMLElement>('[role="option"]').forEach((el, i) => el.setAttribute('aria-selected', String(i === index)));
    const el = index >= 0 ? document.getElementById(`${listId}-${index}`) : null;
    if (el) {
      input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  async function load() {
    const q = input.value.trim();
    const ctx = opts.context?.() ?? {};
    const exclude = new Set(ctx.excludeEans ?? []);
    controller?.abort();
    controller = new AbortController();
    items = [];
    show(SKELETON);
    list.setAttribute('aria-busy', 'true');

    // Sin texto: sugerencias de la misma categoría que el otro producto (o los mejor evaluados).
    const searching = q.length >= 2;
    const query: Partial<CatalogQuery> = searching
      ? { q, limit: limit + exclude.size }
      : { category: ctx.category, sort: 'score_desc', limit: limit + exclude.size };
    try {
      const { items: found } = await fetchCatalog(query, controller.signal);
      items = found.filter((p) => !exclude.has(p.ean)).slice(0, limit);
      const header = searching
        ? `Resultados para "${q}"`
        : ctx.category
          ? `Mejor evaluados en ${categoryName(ctx.category)}`
          : 'Mejor evaluados';
      show(
        items.length
          ? `<li role="presentation" class="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-stone-400 uppercase">${e(header)}</li>` +
              items.map((p, i) => optionHtml(p, `${listId}-${i}`, i)).join('')
          : note(searching ? `Sin resultados para "${e(q)}". Prueba con la marca o el código de barras.` : 'Aún no hay productos para sugerir.'),
      );
      active = -1;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      show(note('No pudimos buscar. Revisa tu conexión e inténtalo de nuevo.'));
    } finally {
      list.removeAttribute('aria-busy');
    }
  }

  const pick = (item: ProductSummary | undefined) => {
    if (!item) return;
    close();
    opts.onPick(item);
  };

  input.addEventListener('focus', () => void load());
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void load(), DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) return void load();
      if (!items.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(items[active] ?? (items.length === 1 ? items[0] : undefined));
    } else if (event.key === 'Escape' && !list.hidden && !opts.inline) {
      event.preventDefault();
      close();
    }
  });
  if (!opts.inline) input.addEventListener('blur', () => setTimeout(close, 150));

  // mousedown sin foco: el input no pierde el foco antes del clic.
  list.addEventListener('mousedown', (event) => event.preventDefault());
  list.addEventListener('click', (event) => {
    const option = (event.target as Element).closest<HTMLElement>('[data-index]');
    if (option) pick(items[Number(option.dataset.index)]);
  });

  return { focus: () => input.focus(), close, reload: () => void load() };
}
