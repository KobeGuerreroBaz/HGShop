export const prerender = false;
import type { APIRoute } from 'astro';
import { jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';

export const GET: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'categorias');
  if (bloqueo) return bloqueo;

  const client = sanityClientEscritura();

  try {
    const categorias = await client.fetch(`
      *[_type == "categoria" && defined(departamento)]{
        _id,
        titulo,
        departamento
      } | order(departamento asc, titulo asc)
    `);

    return jsonOk(categorias);
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
