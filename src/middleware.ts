import { defineMiddleware } from 'astro:middleware';

// El sitio no carga scripts de terceros ni usa nonces, así que script-src y
// style-src necesitan 'unsafe-inline' para no romper los <script> y los pocos
// style="" inline que ya existen. Aun así, esta política cierra bastante:
// nada de iframes ajenos, nada de <object>/<embed>, y las imágenes/fuentes
// quedan limitadas a los dominios que realmente se usan (Sanity, Google Fonts).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https://cdn.sanity.io data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  if (import.meta.env.PROD && url.protocol === 'http:') {
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }

  const response = await next();

  response.headers.set('Content-Security-Policy', CSP);
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  return response;
});
