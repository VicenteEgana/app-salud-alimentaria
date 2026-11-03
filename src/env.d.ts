/// <reference types="astro/client" />

type D1Database = import('@cloudflare/workers-types').D1Database;

/** Bindings y secretos disponibles en Cloudflare Pages (wrangler.toml + .dev.vars). */
interface Env {
  DB: D1Database;
  GEMINI_API_KEY: string;
  ADMIN_SECRET: string;
  /** Cloudflare Turnstile. Con token válido el límite por IP de lecturas con IA es más alto. */
  TURNSTILE_SECRET_KEY?: string;
  ANALYZE_LIMIT_PER_IP_HOUR?: string;
  ANALYZE_LIMIT_PER_IP_HOUR_NO_CAPTCHA?: string;
  ANALYZE_LIMIT_GLOBAL_DAY?: string;
  /** WhatsApp Cloud API (Meta). */
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_GRAPH_VERSION?: string;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

interface ImportMetaEnv {
  /** Inyectado por astro.config.mjs: 'web' (SSR Cloudflare) o 'capacitor' (estático para la app). */
  readonly BUILD_TARGET: 'web' | 'capacitor';
  /** Origen de la API que consume la app móvil, ej. https://sanopasillo.cl */
  readonly PUBLIC_API_BASE_URL?: string;
  readonly PUBLIC_SITE_URL?: string;
  /** Site key pública de Cloudflare Turnstile (opcional). */
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
