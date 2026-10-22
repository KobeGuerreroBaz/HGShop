export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError, jsonOk, verificarAcceso } from '../../lib/api-utils';
import type { MetadatosBusqueda, MetadatosProductoPedido, ResumenBusquedas } from '../../lib/tipos';

// Resumen para /inventario de lo que buscan y piden los clientes
// (ver registrar-busqueda.ts y registrar-pedido.ts).
const PREFIJO = 'busqueda:';
const MAXIMO_PAGINAS = 5; // hasta 5,000 términos distintos
const LIMITE_LISTA = 40;

async function listarTodo<T>(prefijo: string): Promise<T[]> {
  const todos: T[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < MAXIMO_PAGINAS; pagina++) {
    const lista = await env.SESSION.list<T>({ prefix: prefijo, cursor });
    for (const llave of lista.keys) {
      if (llave.metadata) todos.push(llave.metadata);
    }
    if (lista.list_complete) break;
    cursor = lista.cursor;
  }
  return todos;
}

export const GET: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'busquedas');
  if (bloqueo) return bloqueo;

  try {
    const [terminos, pedidos, avisos] = await Promise.all([
      listarTodo<MetadatosBusqueda>(PREFIJO),
      listarTodo<MetadatosProductoPedido>('pedido:'),
      listarTodo<MetadatosProductoPedido>('avisame:'),
    ]);
    const porVeces = (a: MetadatosProductoPedido, b: MetadatosProductoPedido) => b.n - a.n || b.ult.localeCompare(a.ult);

    const masBuscadas = [...terminos].sort((a, b) => b.n - a.n).slice(0, LIMITE_LISTA);
    const sinResultados = terminos
      .filter((t) => t.ultRes === 0)
      .sort((a, b) => b.sin - a.sin || b.n - a.n)
      .slice(0, LIMITE_LISTA);

    const resumen: ResumenBusquedas = {
      total: terminos.length,
      masBuscadas,
      sinResultados,
      masPedidos: pedidos.sort(porVeces).slice(0, LIMITE_LISTA),
      avisame: avisos.sort(porVeces).slice(0, LIMITE_LISTA),
    };
    return jsonOk(resumen);
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
