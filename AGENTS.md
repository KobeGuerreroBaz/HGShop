# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

hgshop ("HG Shop MX", hgstoremx.com) is the product catalog site for a small resale shop (toys, collectibles,
baby items, etc.). There is no real checkout: every "buy" action ends in a prefilled WhatsApp message to the
seller. Product content is authored in Sanity (directly, or through the custom admin tools in this repo) and the
storefront is statically generated from it.

## Stack

- **Astro 7** for the storefront, mostly static-generated pages, Tailwind v4 via `@tailwindcss/vite`
- **Sanity** as the CMS — a separate sub-project in `sanity/` with its own `package.json` and Studio config
- **Cloudflare Workers** as the deploy target (`@astrojs/cloudflare` adapter + Wrangler); a KV namespace
  `SESSION` is declared in `wrangler.jsonc` but not currently used by any code
- **Google Gemini** (`@google/generative-ai`, model `gemini-flash-lite-latest`) generates product copy
  (title, description, alt text, keywords) from a product photo, both in the admin upload flow and in the
  standalone `scripts/`

## Development

Start the dev server in background mode:

```
astro dev --background
```

Manage it with `astro dev stop`, `astro dev status`, and `astro dev logs`.

Other root commands (`package.json`):
- `npm run build` — production build to `./dist`
- `npm run preview` — build, then `wrangler dev` (runs against the actual Workers runtime locally)
- `npm run deploy` — build, then `wrangler deploy`
- `npm run generate-types` — regenerate `worker-configuration.d.ts` from the bindings in `wrangler.jsonc`

Sanity Studio lives in `sanity/` and has its own install/commands (`npm run dev`, `npm run deploy`, etc. from
inside that directory).

There is no configured test runner and no root lint script (`sanity/` has its own `eslint.config.mjs`).

### One-off data / import scripts (`scripts/*.mjs`)

Run with Node from the repo root; they read `SANITY_PROJECT_ID`, `SANITY_API_TOKEN`, `GEMINI_API_KEY` from
`.env` (via `dotenv`) and talk to Sanity directly with a write token — not part of the deployed site.

- `cargar-producto.mjs` — interactive: analyze one photo with Gemini, let you confirm/edit the fields, create a
  `producto` document
- `cargar-carpeta.mjs` — bulk version of the same flow over a folder of photos
- `recortar-categoria.mjs` — asks Gemini for a product's bounding box in a photo and crops it with `sharp`,
  batch-run over a category
- `corregir-departamento-bebes.mjs` — a one-off Sanity data fix (normalizing a `departamento` slug); useful as a
  template for future one-off migrations rather than as a script you'd run again

## Architecture

### Content model (`sanity/schemaTypes/`)

- **`producto`** — the product document: `titulo`/`slug`, `precio`, `cantidadDisponible` (internal, never shown
  to customers directly), `estado`, `descripcion`, `altTexto`, `imagenPrincipal` + `galeria`, a reference to
  `categoria`, `palabrasClave` (internal search keywords), `marca`, `hashFoto` (used to detect re-uploads of the
  same photo), `mostrarExistencias` (opt-in generic "low stock" badge) and `agotado` (sold out — hides all buy
  actions site-wide).
- **`categoria`** — `titulo`/`slug` plus a `departamento` string slug. Categories are grouped into departments
  (e.g. `bebes`, `hot-wheels`, `pokemon-tcg`); a category's `departamento` is what routes it under
  `/catalogo/[departamento]`.
- **`configuracionWhatsApp`** — a singleton document with `numeroDefault` (the fallback WhatsApp number) and
  `asignaciones[]` mapping a `departamento` to a different `numero` and an optional display name
  (`nombreBonito`). This is how, e.g., one department can ring a different phone than the rest of the shop.
  `src/lib/sanity.ts` (`numeroWhatsAppParaDepartamento`, `nombreDepartamento`) is the single place that resolves
  department → phone number / display name, falling back to a hardcoded `NOMBRES_BONITOS` map when Sanity has
  no override for that department.

**"No price yet" is a real, load-bearing state, not an edge case.** Products are often created through the AI
photo pipeline before anyone has priced them. `!defined(precio)` is the filter used everywhere that means
"needs attention" (`api/departamentos.ts`, `api/productos-sin-precio.ts`), and pricing is meant to happen
through `/precios` before a product is expected to be seen publicly.

### Storefront pages (`src/pages/`)

- `index.astro` — department grid, plus client-side search across all products (a plain substring match over
  `titulo` + `palabrasClave` done in the browser, not a Sanity query)
- `catalogo/[departamento].astro` — statically generated per department (`getStaticPaths`), products grouped by
  category with an in-place "ver más" expand and the same in-page search
- `productos/[slug].astro` — statically generated per product; photo gallery, JSON-LD `Product` +
  `BreadcrumbList` structured data, WhatsApp deep link
- `pedido.astro` — SSR (`export const prerender = false`) order summary. Reads `?productos=slug1,slug2` (built
  by the cart) and re-fetches those products from Sanity to render a summary + total
- `subir.astro`, `precios.astro` — internal admin tools, see below

Public pages are prerendered against Sanity content at build time — there's no ISR/on-demand revalidation, so
content changes need a rebuild/redeploy to go live. The admin pages and all of `src/pages/api/*` are SSR
(`prerender = false`).

### Cart (`src/lib/carrito.ts`, `BotonCarrito`/`PanelCarrito`/`ProductCard`)

No server-side cart or payment — `carrito.ts` is a localStorage wrapper (key `hg_carrito`). Notable behavior:
**adding a second item to the cart disables every product page's individual "Pedir en WApp" button**
(`ProductCard`'s `estaBloqueado()` check) — once the cart has 2+ items you must check out through the cart's
single combined WhatsApp message instead of mixing flows. `construirEnvioCarrito` picks which WhatsApp number
gets the combined order by majority vote across the cart items' assigned numbers (ties favor `numeroDefault`),
and the WhatsApp message links to `/pedido?productos=...` rather than listing products inline in the message.

### Admin tools (`subir.astro`, `precios.astro`, `src/pages/api/*`)

Not a real auth system — every API route is gated by a single shared PIN (`UPLOAD_PIN`, a Cloudflare secret set
via `wrangler secret put`, not present in `wrangler.jsonc` vars or `.env`) checked against the `x-upload-pin`
request header by a `pinValido()` helper duplicated in each route. `verificar-pin.ts` just echoes whether a
submitted PIN is correct, for the client-side PIN screen.

- `subir.astro` — upload flow: pick/paste photos → `POST /api/analizar` (Gemini fills título/descripción/
  altTexto/palabrasClave from the image plus optional free-text context) → pick or create a category/department
  (`POST /api/crear-categoria`, which can also add/update a `configuracionWhatsApp` assignment) →
  `POST /api/crear-producto` (uploads images as Sanity assets, builds a unique slug as
  `<titulo-slug>-<últimos 8 chars del asset id>`, stores `hashFoto`). `POST /api/verificar-hash` is called
  client-side to warn when a photo looks like a re-upload of an existing product.
- `precios.astro` — two modes: walk unpriced products department-by-department (`GET /api/departamentos` +
  `GET /api/productos-sin-precio`), or search-and-edit any product (`GET /api/buscar-productos`); both save
  through `POST /api/actualizar-precio` (precio, cantidad, marca, palabrasClave, mostrarExistencias, agotado).

These pages are excluded from the sitemap (see the `filter` in `astro.config.mjs`) and rendered with
`noIndex` on `Layout`, but the PIN is the only real access control — the URLs are not otherwise protected.

### SEO/metadata (`src/layouts/Layout.astro`)

Central place for `<title>`, meta description, canonical URL, and OG/Twitter tags, plus a `noIndex` prop for the
admin pages. Per-page JSON-LD (`Product`, `BreadcrumbList`, `Organization`) is built in the page itself and
injected through the `head` slot rather than living in `Layout`.

## Historial y decisiones

Cronología de cómo llegó el proyecto a su estado actual, tal como la contó el usuario — contexto que no se
deduce solo leyendo el código (razones descartadas, decisiones de producto, reglas de negocio no obvias desde
el schema). Fechas de 2026 salvo que se indique otra cosa.

### ~19 jul — Automatización de los scripts de carga
Se afinaron `cargar-producto.mjs` y `cargar-carpeta.mjs`. Gemini había propuesto 5 mejoras (`responseSchema`,
optimización de imagen con `sharp`, validación de duplicados, reintentos, limpieza de assets huérfanos). Se
priorizaron e implementaron solo `responseSchema` y la compresión con `sharp`; se descartó explícitamente la
recomendación de modelo que dio la IA en ese momento por estar desactualizada (el modelo se fijaría después, ver
21 jul).

### 21 jul — Flujo de trabajo y pipeline de subida
Se fijó el stack completo: Astro + Tailwind v4 + Sanity + Cloudflare Workers + GitHub. Se construyó un
**pipeline dual** de carga de productos que comparten deduplicación:
- Script de Mac (`cargar-carpeta.mjs`), con manifiesto local `.ya-procesados.json` (hash SHA-1) para no
  reprocesar fotos ya subidas desde esa máquina.
- Interfaz móvil `/subir`: compresión vía `canvas`, PIN por header `x-upload-pin`, y `hashFoto` guardado en
  Sanity para deduplicación **cruzada** entre ambos flujos — el mismo producto no se duplica sin importar por
  cuál de los dos caminos se haya subido.

Se fijó el modelo `gemini-flash-lite-latest`. Se resolvió también el flujo óptimo de captura de fotos: usar
"Captura de Imagen" por cable en vez de subir por iCloud (evita problemas de sincronía/calidad).

### 30 jul — Herramienta admin de precios (`/precios`)
Requisitos definidos antes de programar. Dos modos:
1. **"Poner precio"** — recorre por departamento solo los productos que aún no tienen precio.
2. **"Actualizar precios"** — búsqueda manual por nombre para editar cualquier producto existente.

Se agregó el campo `mostrarExistencias`: un badge de disponibilidad genérico — **nunca se muestra la cantidad
exacta al público**, esa cifra (`cantidadDisponible`) es solo control interno. Entregables de esta sesión:
`precios.astro`, `departamentos.ts`, `productos-sin-precio.ts`, `buscar-productos.ts`, `actualizar-precio.ts` y
cambios al schema de `producto`.

### 31 jul — Exploración de marca/dominio alternativo
Sesión aparte evaluando si comprar un dominio nuevo para diferenciarse de un competidor similar. Terminó en el
nombre **"USWAREHOUSEMX"** y una tabla de conceptos de logo (Space Grotesk, JetBrains Mono, verde bosque, acento
óxido). **No confirmado**: no está claro en el historial si esta dirección de marca se adoptó o quedó
descartada — confirmar con el usuario antes de asumir que sigue vigente.

### 31 jul — Primera ronda de diseño visual
Tres mockups **rechazados** por verse "muy IA": "Bazar Confianza" (bento/navy-marigold), "Catálogo Directo"
(ledger minimalista), "Tianguis Color" (sticker cards). Se evaluó y descartó v0.dev como herramienta de diseño.
Con fotos reales de producto se probó un cuarto estilo tipo corkboard/washi-tape — también rechazado.

Se llegó a una quinta dirección — grid limpio, Space Grotesk + JetBrains Mono, acento verde bosque (alineado al
verde de WhatsApp), etiquetas tipo código de barras, fotos reales sobre fondo blanco — pero la reacción a esa
dirección no quedó registrada en el momento. (El sitio actual usa Inter y neutrales, no Space Grotesk/JetBrains
Mono ni verde bosque, así que si esta dirección se retoma implicaría un cambio real de estilo, no solo
continuar lo existente.)

### 31 jul ("Continuación 1")
Trabajo construido en esta sesión:
- `recortar-categoria.mjs`: recorte automático de fotos vía bounding boxes de Gemini, con backoff en reintentos.
- Sistema de ruteo de WhatsApp por departamento (`configuracionWhatsApp`, documento singleton en Sanity).
- Open Graph tags en `Layout.astro` — confirmado funcionando al compartir links en WhatsApp Business.
- Botón "Volver" con `history.back()` y fallback a la URL del departamento si no hay historial válido.
- `IndicadorFlotante.astro` con estilo "liquid glass".
- Grid de productos responsivo: 4 columnas en desktop, 2 en móvil.
- Prompt de Gemini afinado para responder siempre en español, con enfoque de SEO y de venta.
- Creación de categorías desde `/subir`, incluyendo selector de a qué número de WhatsApp se asigna el
  departamento nuevo.
- Helper `nombreDepartamento()` con diccionario `NOMBRES_BONITOS`.

### 2 ago — Carrito de compras sin cobro
Sistema de carrito completo: localStorage, ícono en el header, genera link a `/pedido` (página dinámica SSR,
`prerender = false`). El pedido combinado se enruta al WhatsApp que tenga **mayoría de productos** en el
carrito (`construirEnvioCarrito`).

**Regla de negocio deliberada**: mientras haya algo en el carrito, el botón individual "Pedir en WApp" de cada
producto queda bloqueado — se revisó específicamente para que se libere al vaciar el carrito, para no dejarlo
bloqueado por error una vez que el carrito vuelve a estar vacío.

Trabajo de seguridad e infraestructura en la misma sesión:
- **Auditoría de seguridad** de los endpoints admin: se confirmó que el PIN se valida server-side vía
  `UPLOAD_PIN`, no solo en el cliente.
- **Rate limiting**: se configuró una regla en el dashboard de Cloudflare contra fuerza bruta sobre
  `/api/verificar-pin`. Esta regla vive en la configuración de Cloudflare, no en este repo (no aparece en
  `wrangler.jsonc` ni en el código) — tenerlo presente si se audita seguridad solo desde el código.

Otros cambios de esta sesión:
- Rediseño del header a grid de 3 columnas.
- Buscador sticky implementado con `ResizeObserver` para ajustarse a la altura real del header.
- Límite de productos visibles por categoría antes de "ver más" subido de 2 a 4.
- Botón renombrado a "Pedir en WApp".
- Corrección de un departamento duplicado (`Bebes` vs `bebes`) vía el script one-off
  `corregir-departamento-bebes.mjs`, y se agregó un dropdown de departamentos existentes en `/subir` para
  prevenir que se repita ese tipo de duplicado a futuro.

### 2 ago — SEO y rastreo
Se instaló `@astrojs/sitemap` y se agregó `robots.txt`. `noIndex` aplicado a `/subir`, `/precios`, `/pedido`.
Canonical tags y Schema.org `Organization` agregados en el home. Campo `altTexto` generado por Gemini,
propagado end-to-end: `analizar.ts` → `subir.astro` → `crear-producto.ts` → scripts de Mac. Descripciones SEO
por departamento redactadas en formato de lista (reemplazando el scroll lateral que había antes).

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
