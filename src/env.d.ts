// `wrangler types` (npm run generate-types) solo conoce los bindings declarados en
// wrangler.jsonc y .dev.vars — no puede saber los nombres de los secrets de Cloudflare
// (SANITY_API_TOKEN, GEMINI_API_KEY), que se configuran aparte vía `wrangler secret put`
// y nunca viven en este repo. Esto se fusiona con worker-configuration.d.ts.
declare namespace Cloudflare {
  interface Env {
    UPLOAD_PIN: string;
    SANITY_API_TOKEN: string;
    GEMINI_API_KEY: string;
  }
}
