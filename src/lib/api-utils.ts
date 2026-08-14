import { createClient } from '@sanity/client';
import { env } from 'cloudflare:workers';

export function pinValido(request: Request): boolean {
  const pin = request.headers.get('x-upload-pin');
  return pin === env.UPLOAD_PIN;
}

export function sanityClientEscritura() {
  return createClient({
    projectId: env.SANITY_PROJECT_ID,
    dataset: 'production',
    apiVersion: '2024-01-01',
    token: env.SANITY_API_TOKEN,
    useCdn: false,
  });
}

export function jsonOk(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function jsonError(mensaje: string, status = 400): Response {
  return new Response(JSON.stringify({ error: mensaje }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function noAutorizado(): Response {
  return jsonError('No autorizado', 401);
}

const LIMITE_POR_VENTANA = 30;
const VENTANA_SEGUNDOS = 60;

/**
 * Límite simple por IP + ruta usando el KV SESSION (antes declarado y sin usar).
 * El incremento no es atómico, pero es suficiente para el volumen de tráfico
 * admin de esta tienda — no busca ser exacto, solo frenar fuerza bruta/abuso.
 */
export async function excedeLimite(request: Request, ruta: string): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip') || 'sin-ip';
  const clave = `ratelimit:${ruta}:${ip}`;
  const actual = Number((await env.SESSION.get(clave)) || '0');
  if (actual >= LIMITE_POR_VENTANA) return true;
  await env.SESSION.put(clave, String(actual + 1), { expirationTtl: VENTANA_SEGUNDOS });
  return false;
}

export function demasiadasSolicitudes(): Response {
  return jsonError('Demasiadas solicitudes, intenta de nuevo en un momento', 429);
}

/**
 * Gate combinado para las rutas admin: primero limita por IP (así también
 * frena intentos con PIN incorrecto repetido), luego valida el PIN.
 * Devuelve una Response si hay que cortar, o null si la ruta puede seguir.
 */
export async function verificarAcceso(request: Request, ruta: string): Promise<Response | null> {
  if (await excedeLimite(request, ruta)) {
    return demasiadasSolicitudes();
  }
  if (!pinValido(request)) {
    return noAutorizado();
  }
  return null;
}
