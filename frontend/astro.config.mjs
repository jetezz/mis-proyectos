import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';

export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  integrations: [react()],
  server: {
    port: 4321,
    host: true,
  },
  // Sistema de env tipado de Astro 5:
  // 'secret' = solo server-side (nunca llegan al bundle del browser)
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: 'server', access: 'secret' }),
      SUPABASE_ANON_KEY: envField.string({ context: 'server', access: 'secret' }),
      API_URL: envField.string({
        context: 'server',
        access: 'secret',
        default: 'http://api:3000',
      }),
    },
  },
});
