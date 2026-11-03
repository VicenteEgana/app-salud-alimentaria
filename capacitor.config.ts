import type { CapacitorConfig } from '@capacitor/cli';

// Build de la app: `npm run cap:sync` (BUILD_TARGET=capacitor → ./dist estático).
const config: CapacitorConfig = {
  appId: 'cl.sanopasillo.app',
  appName: 'SanoPasillo',
  webDir: 'dist',
  plugins: {
    Camera: {
      // Solo se usa como fallback cuando el EAN no está en la base: foto de la etiqueta.
      presentationStyle: 'fullscreen',
    },
  },
};

export default config;
