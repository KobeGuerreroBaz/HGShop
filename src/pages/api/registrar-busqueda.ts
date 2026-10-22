export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { excedeLimite } from '../../lib/api-utils';
import { normalizar } from '../../lib/buscador';
import type { MetadatosBusqueda } from '../../lib/tipos';

// Registro anónimo de búsquedas del catálogo (sin IP ni datos personales): solo el
// término, cuántas veces se buscó y cuántas veces no hubo resultados. Se guarda en
// el KV SESSION como metadatos de la clave, para poder listar todo de una sola vez
// desde /inventario sin leer clave por clave.
//
// Ojo con el plan gratis de Cloudflare KV: 1,000 escrituras al día. Cada búsqueda
// registrada usa 2 (el límite por IP y el contador), o sea ~500 búsquedas al día.

const PREFIJO = 'busqueda:';
const DURACION_SEGUNDOS = 60 * 60 * 24 * 180; // se borra sola si nadie la busca en 6 meses

const sinContenido = () => new Response(null, { status: 204 });

export const POST: APIRoute = async ({ request }) => {
  try {
    if (await excedeLimite(request, 'registrar-busqueda')) return sinContenido();

    const datos = (await request.json()) as { termino?: unknown; resultados?: unknown; pagina?: unknown };
    const termino = typeof datos.termino === 'string' ? datos.termino.trim().slice(0, 60) : '';
    const clave = normalizar(termino);
    const resultados = Number.isFinite(Number(datos.resultados)) ? Math.max(0, Math.floor(Number(datos.resultados))) : 0;
    const pagina = typeof datos.pagina === 'string' ? datos.pagina.slice(0, 40) : '';

    if (clave.length < 2 || clave.length > 60) return sinContenido();

    const llave = `${PREFIJO}${clave}`;
    const { metadata } = await env.SESSION.getWithMetadata<MetadatosBusqueda>(llave);
    const nuevo: MetadatosBusqueda = {
      t: termino,
      n: (metadata?.n || 0) + 1,
      sin: (metadata?.sin || 0) + (resultados === 0 ? 1 : 0),
      ultRes: resultados,
      ult: new Date().toISOString().slice(0, 10),
      pag: pagina,
    };
    await env.SESSION.put(llave, '', { metadata: nuevo, expirationTtl: DURACION_SEGUNDOS });
  } catch {
    // Nunca debe fallar hacia el cliente: el registro es solo informativo.
  }
  return sinContenido();
};
