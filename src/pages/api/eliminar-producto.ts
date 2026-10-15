export const prerender = false;
import type { APIRoute } from 'astro';
import { jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';

export const POST: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'eliminar-producto');
  if (bloqueo) return bloqueo;

  try {
    const { id } = (await request.json()) as { id?: string };

    if (!id) return jsonError('Falta id');

    const client = sanityClientEscritura();

    // Solo se permite borrar documentos de tipo "producto" (nunca categorías ni configuración).
    const existe = await client.fetch(`*[_type == "producto" && _id == $id][0]._id`, { id });
    if (!existe) return jsonError('El producto no existe', 404);

    // También se borra el borrador de Sanity Studio si existiera, para que no reaparezca.
    // Las fotos (assets) se quedan en Sanity; no estorban y se pueden limpiar aparte.
    await client.transaction().delete(id).delete(`drafts.${id}`).commit();

    return jsonOk({ ok: true });
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
