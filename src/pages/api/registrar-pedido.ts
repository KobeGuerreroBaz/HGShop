export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { excedeLimite } from '../../lib/api-utils';
import type { MetadatosProductoPedido } from '../../lib/tipos';

// Registro anónimo (sin IP ni datos personales) de:
// - 'pedido': cada producto de un carrito enviado por WhatsApp (clave pedido:<slug>).
// - 'avisame': agotados por los que pidieron aviso (clave avisame:<slug>).
// Se guardan como metadatos de la clave en el KV SESSION para listarlos de una sola vez
// en /inventario. Cuenta toques del botón, no ventas confirmadas.
// Plan gratis de KV: 1,000 escrituras al día (cada producto registrado usa 1, más 1 del
// límite por IP).

const TIPOS = { pedido: 'pedido:', avisame: 'avisame:' } as const;
const MAXIMO_PRODUCTOS = 30;
const DURACION_SEGUNDOS = 60 * 60 * 24 * 180; // 6 meses sin actividad → se borra sola
const SLUG_VALIDO = /^[a-z0-9-]{1,150}$/;

const sinContenido = () => new Response(null, { status: 204 });

export const POST: APIRoute = async ({ request }) => {
  try {
    if (await excedeLimite(request, 'registrar-pedido')) return sinContenido();

    const datos = (await request.json()) as { tipo?: unknown; productos?: unknown };
    const prefijo = typeof datos.tipo === 'string' ? TIPOS[datos.tipo as keyof typeof TIPOS] : undefined;
    if (!prefijo || !Array.isArray(datos.productos)) return sinContenido();

    const hoy = new Date().toISOString().slice(0, 10);
    const vistos = new Set<string>();
    for (const item of datos.productos.slice(0, MAXIMO_PRODUCTOS)) {
      const slug = typeof item?.slug === 'string' ? item.slug : '';
      const titulo = typeof item?.titulo === 'string' ? item.titulo.trim().slice(0, 150) : '';
      if (!SLUG_VALIDO.test(slug) || vistos.has(slug)) continue;
      vistos.add(slug);

      const llave = `${prefijo}${slug}`;
      const { metadata } = await env.SESSION.getWithMetadata<MetadatosProductoPedido>(llave);
      const nuevo: MetadatosProductoPedido = {
        s: slug,
        t: titulo || metadata?.t || slug,
        n: (metadata?.n || 0) + 1,
        ult: hoy,
      };
      await env.SESSION.put(llave, '', { metadata: nuevo, expirationTtl: DURACION_SEGUNDOS });
    }
  } catch {
    // Solo informativo: nunca falla hacia el cliente.
  }
  return sinContenido();
};
