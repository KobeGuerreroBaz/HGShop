export const prerender = false;
import type { APIRoute } from 'astro';
import { jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';

export const POST: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'mover-producto');
  if (bloqueo) return bloqueo;

  try {
    const { id, categoriaId } = (await request.json()) as { id?: string; categoriaId?: string };

    if (!id) return jsonError('Falta id');
    if (!categoriaId) return jsonError('Falta la categoría destino');

    const client = sanityClientEscritura();

    const categoria = await client.fetch(
      `*[_type == "categoria" && _id == $categoriaId][0]{ _id, titulo, departamento }`,
      { categoriaId }
    );
    if (!categoria) return jsonError('La categoría destino no existe', 404);

    const producto = await client.fetch(`*[_type == "producto" && _id == $id][0]._id`, { id });
    if (!producto) return jsonError('El producto no existe', 404);

    await client
      .patch(id)
      .set({ categoria: { _type: 'reference', _ref: categoriaId } })
      .commit();

    return jsonOk({
      ok: true,
      categoriaTitulo: categoria.titulo,
      departamento: categoria.departamento,
    });
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
