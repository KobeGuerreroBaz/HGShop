export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError, jsonOk, verificarAcceso } from '../../lib/api-utils';
import type { MetadatosBusqueda, ResumenBusquedas } from '../../lib/tipos';

// Resumen para /inventario de lo que buscan los clientes (ver registrar-busqueda.ts).
const PREFIJO = 'busqueda:';
const MAXIMO_PAGINAS = 5; // hasta 5,000 términos distintos
const LIMITE_LISTA = 40;

export const GET: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'busquedas');
  if (bloqueo) return bloqueo;

  try {
    const terminos: MetadatosBusqueda[] = [];
    let cursor: string | undefined;
    for (let pagina = 0; pagina < MAXIMO_PAGINAS; pagina++) {
      const lista = await env.SESSION.list<MetadatosBusqueda>({ prefix: PREFIJO, cursor });
      for (const llave of lista.keys) {
        if (llave.metadata) terminos.push(llave.metadata);
      }
      if (lista.list_complete) break;
      cursor = lista.cursor;
    }

    const masBuscadas = [...terminos].sort((a, b) => b.n - a.n).slice(0, LIMITE_LISTA);
    const sinResultados = terminos
      .filter((t) => t.ultRes === 0)
      .sort((a, b) => b.sin - a.sin || b.n - a.n)
      .slice(0, LIMITE_LISTA);

    const resumen: ResumenBusquedas = { total: terminos.length, masBuscadas, sinResultados };
    return jsonOk(resumen);
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
