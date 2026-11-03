/**
 * Perfiles personales (celíaco, sin lactosa, APLV, vegano, diabetes, niños).
 *
 * Se evalúan en el dispositivo y el perfil elegido nunca se envía al servidor: son datos de salud
 * (sensibles según la Ley 21.719). El resultado es orientativo y nunca afirma que algo es "apto":
 * dice qué se detectó y qué no en los ingredientes.
 */
import { KIDS_WARNING_TEXT } from './sweeteners';
import { normalizeText } from './text';

export type ProfileId = 'celiaco' | 'sin-lactosa' | 'aplv' | 'vegano' | 'diabetes' | 'ninos';
export type ProfileStatus = 'ok' | 'revisar' | 'alerta';

export interface ProfileDefinition {
  id: ProfileId;
  name: string;
  description: string;
}

export const PROFILES: ProfileDefinition[] = [
  { id: 'celiaco', name: 'Celíaco / sin gluten', description: 'Trigo, cebada, centeno, avena no certificada y trazas.' },
  { id: 'sin-lactosa', name: 'Intolerancia a la lactosa', description: 'Leche y derivados que no sean sin lactosa.' },
  { id: 'aplv', name: 'Alergia a la proteína de leche (APLV)', description: 'Cualquier derivado lácteo, incluso deslactosado, y trazas.' },
  { id: 'vegano', name: 'Vegano', description: 'Ingredientes de origen animal: lácteos, huevo, miel, carnes, gelatina, carmín…' },
  { id: 'diabetes', name: 'Diabetes / control de azúcar', description: 'Azúcares añadidos, sello de azúcares y polioles.' },
  { id: 'ninos', name: 'Para niños', description: 'Edulcorantes, colorantes azoicos, cafeína y sellos.' },
];

export interface ProfileInput {
  ingredientsRaw: string;
  dietaryTags: string[];
  evaluation: {
    hasAddedSugar: boolean;
    minsalSeals: string[];
    additives: { id: string; name: string; level: number }[];
    kidsSweetenerWarning?: boolean;
  };
}

export interface ProfileCheck {
  profile: ProfileDefinition;
  status: ProfileStatus;
  reasons: string[];
}

const TRACES_RE = /\b(puede contener|contiene trazas|trazas de|elaborado en (una )?(linea|planta)[^.]*)([^.]*)/g;

/** Separa los ingredientes de la declaración de trazas ("Puede contener trazas de…"). */
function splitTraces(raw: string): { ingredients: string; traces: string } {
  const text = normalizeText(raw);
  const traces = [...text.matchAll(TRACES_RE)].map((m) => m[0]).join(' ');
  return { ingredients: text.replace(TRACES_RE, ' '), traces };
}

const hasTag = (tags: string[], re: RegExp) => tags.some((t) => re.test(normalizeText(t)));
const firstMatch = (text: string, re: RegExp) => text.match(re)?.[0];

const GLUTEN_RE = /\b(trigo|cebada|centeno|malta|gluten|espelta|kamut|seitan|triticale|semola|cuscus)\b/;
const OATS_RE = /\bavena\b/;
const GLUTEN_FREE_RE = /\b(sin gluten|libre de gluten)\b/;

const MILK_RE =
  /\b(leche|lactosa|suero|lacteos?|crema|mantequilla|queso|yogh?urt?|manjar|caseina|caseinato|lactoalbumina|lactoglobulina|nata|ghee|kefir)\b/;
const LACTOSE_FREE_RE = /\b(sin lactosa|deslactosad[oa]|lactasa|0\s?% lactosa|libre de lactosa)\b/;

const ANIMAL_RE =
  /\b(leche|lactosa|suero|crema|mantequilla|queso|yogh?urt?|manjar|caseina|caseinato|huevos?|clara de huevo|yema|miel|carne|pollo|pavo|cerdo|vacuno|res|tocino|jamon|pescado|atun|salmon|anchoas?|mariscos?|camaron|gelatina|colageno|carmin|cochinilla|grasa animal|manteca de cerdo|lanolina|cera de abeja|propoleo)\b|\b(sin|ins|e)\s*-?\s*120\b/;
const ANIMAL_ORIGIN_RE = /\(origen animal\)/;
const VITAMIN_D3_RE = /\bvitamina d3\b/;

const CAFFEINE_RE = /\bcafeina\b|\bguarana\b/;
const AZO_DYES = new Set(['tartrazina', 'amarillo-crepusculo', 'rojo-allura']);

function check(profile: ProfileDefinition, status: ProfileStatus, reasons: string[]): ProfileCheck {
  return { profile, status, reasons };
}

export function checkProfile(id: ProfileId, input: ProfileInput): ProfileCheck {
  const profile = PROFILES.find((p) => p.id === id)!;
  const { ingredients, traces } = splitTraces(input.ingredientsRaw);
  const ev = input.evaluation;

  switch (id) {
    case 'celiaco': {
      const gluten = firstMatch(ingredients, GLUTEN_RE);
      // "sin gluten" en la lista no cuenta como ingrediente con gluten.
      if (gluten && !GLUTEN_FREE_RE.test(ingredients)) return check(profile, 'alerta', [`Contiene ${gluten}`]);
      if (GLUTEN_RE.test(traces)) return check(profile, 'alerta', ['Puede contener trazas de gluten']);
      if (OATS_RE.test(ingredients)) return check(profile, 'revisar', ['Contiene avena: solo es segura si está certificada sin gluten']);
      if (hasTag(input.dietaryTags, GLUTEN_FREE_RE) || GLUTEN_FREE_RE.test(ingredients)) {
        return check(profile, 'ok', ['Declarado libre de gluten']);
      }
      return check(profile, 'revisar', ['No detectamos gluten en los ingredientes, pero no está declarado libre de gluten']);
    }
    case 'sin-lactosa': {
      if (hasTag(input.dietaryTags, LACTOSE_FREE_RE) || LACTOSE_FREE_RE.test(ingredients)) {
        return check(profile, 'ok', ['Declarado sin lactosa']);
      }
      const milk = firstMatch(ingredients, MILK_RE);
      if (milk) return check(profile, 'alerta', [`Contiene ${milk}`]);
      return check(profile, 'ok', ['No detectamos lácteos en los ingredientes']);
    }
    case 'aplv': {
      const milk = firstMatch(ingredients, MILK_RE);
      if (milk) return check(profile, 'alerta', [`Contiene ${milk} (la proteína de leche está aunque sea sin lactosa)`]);
      if (MILK_RE.test(traces)) return check(profile, 'alerta', ['Puede contener trazas de leche']);
      return check(profile, 'revisar', ['No detectamos leche en los ingredientes; confirma la declaración de alérgenos del envase']);
    }
    case 'vegano': {
      const animal = firstMatch(ingredients, ANIMAL_RE);
      if (animal) return check(profile, 'alerta', [`Contiene ${animal}`]);
      if (ANIMAL_ORIGIN_RE.test(ingredients)) return check(profile, 'alerta', ['Declara un ingrediente de origen animal']);
      if (VITAMIN_D3_RE.test(ingredients)) return check(profile, 'revisar', ['La vitamina D3 suele ser de origen animal']);
      return check(profile, 'ok', ['No detectamos ingredientes de origen animal']);
    }
    case 'diabetes': {
      const reasons: string[] = [];
      if (ev.minsalSeals.includes('ALTO EN AZÚCARES')) return check(profile, 'alerta', ['Sello ALTO EN AZÚCARES']);
      if (ev.hasAddedSugar) reasons.push('Contiene azúcares añadidos');
      if (ev.additives.some((a) => a.id === 'polioles')) reasons.push('Contiene polioles: también elevan la glucosa, en menor medida');
      if (ev.additives.some((a) => a.id === 'jmaf')) return check(profile, 'alerta', ['Contiene jarabe de maíz de alta fructosa']);
      return reasons.length ? check(profile, 'revisar', reasons) : check(profile, 'ok', ['Sin azúcares añadidos detectados']);
    }
    case 'ninos': {
      const reasons: string[] = [];
      let status: ProfileStatus = 'ok';
      if (ev.kidsSweetenerWarning) {
        status = 'alerta';
        reasons.push(`${KIDS_WARNING_TEXT} (leyenda propuesta por el MINSAL)`);
      }
      const azo = ev.additives.filter((a) => AZO_DYES.has(a.id));
      if (azo.length) {
        status = 'alerta';
        reasons.push(`Colorantes asociados a hiperactividad: ${azo.map((a) => a.name).join(', ')}`);
      }
      if (CAFFEINE_RE.test(ingredients)) {
        status = 'alerta';
        reasons.push('Contiene cafeína');
      }
      if (ev.minsalSeals.length > 0 && status === 'ok') {
        status = 'revisar';
        reasons.push(`${ev.minsalSeals.length} sello(s) MINSAL`);
      }
      return check(profile, status, reasons.length ? reasons : ['Sin alertas para niños']);
    }
  }
}

export const PROFILE_STORAGE_KEY = 'sanopasillo:perfiles';

export function loadProfiles(): ProfileId[] {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return ids.filter((id): id is ProfileId => PROFILES.some((p) => p.id === id));
  } catch {
    return [];
  }
}

export function saveProfiles(ids: ProfileId[]): void {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Sin almacenamiento disponible: el perfil dura solo esta visita.
  }
}
