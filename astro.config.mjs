// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import cloudflare from '@astrojs/cloudflare';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://hgstoremx.com',

  // El panel se llamaba /precios; se deja el redirect para favoritos o accesos directos viejos.
  redirects: {
    '/precios': '/inventario',
  },

  vite: {
    plugins: [tailwindcss()]
  },

  adapter: cloudflare(),

  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/subir') &&
        !page.includes('/precios') &&
        !page.includes('/inventario') &&
        !page.includes('/pedido') &&
        !page.includes('/buscar'),
    }),
  ],
});
