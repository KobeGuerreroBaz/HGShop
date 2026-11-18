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
 * Límite por IP + ruta. Usa el limitador de Cloudflare (binding LIMITE), que no gasta
 * escrituras de KV; si no está disponible, cae al contador en KV como antes.
 *
 * Regla de oro: si el limitador falla, NO bloquea. Antes, al agotarse la cuota diaria
 * de KV, el `put` lanzaba, `verificarAcceso` no lo atrapaba y TODAS las rutas admin
 * respondían 500 hasta el día siguiente: no se podía subir, preciar ni marcar agotados.
 */
export async function excedeLimite(request: Request, ruta: string): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip') || 'sin-ip';
  const clave = `${ruta}:${ip}`;
  try {
    const limitador = (env as any).LIMITE;
    if (limitador?.limit) {
      const { success } = await limitador.limit({ key: clave });
      return !success;
    }
    const llave = `ratelimit:${clave}`;
    const actual = Number((await env.SESSION.get(llave)) || '0');
    if (actual >= LIMITE_POR_VENTANA) return true;
    await env.SESSION.put(llave, String(actual + 1), { expirationTtl: VENTANA_SEGUNDOS });
    return false;
  } catch (e) {
    console.warn('[limite] no pude contar, dejo pasar:', e);
    return false;
  }
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
  // Primero el PIN: el uso normal del panel ya no cuenta ni gasta nada.
  if (pinValido(request)) return null;
  // Solo se cuentan los intentos FALLIDOS, que es donde sirve frenar la fuerza bruta.
  if (await excedeLimite(request, `pin:${ruta}`)) return demasiadasSolicitudes();
  return noAutorizado();
}
