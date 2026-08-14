export const prerender = false;
import type { APIRoute } from 'astro';
import { jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';

export const POST: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'actualizar-precio');
  if (bloqueo) return bloqueo;

  try {
    const datos = (await request.json()) as {
      id: string;
      precio?: string | number;
      cantidad?: string | number;
      marca?: string;
      palabrasClave?: string[];
      mostrarExistencias?: boolean;
      agotado?: boolean;
    };
    const { id, precio, cantidad, marca, palabrasClave, mostrarExistencias, agotado } = datos;

    if (!id) {
      return jsonError('Falta id');
    }

    const client = sanityClientEscritura();

    const cambios: Record<string, unknown> = {};
    if (precio !== undefined && precio !== null && precio !== '') {
      cambios.precio = Number(precio);
    }
    if (cantidad !== undefined && cantidad !== null && cantidad !== '') {
      cambios.cantidadDisponible = Number(cantidad);
    }
    if (marca) cambios.marca = marca;
    if (Array.isArray(palabrasClave) && palabrasClave.length > 0) {
      cambios.palabrasClave = palabrasClave;
    }
    if (typeof mostrarExistencias === 'boolean') {
      cambios.mostrarExistencias = mostrarExistencias;
    }
    if (typeof agotado === 'boolean') {
      cambios.agotado = agotado;
    }

    if (Object.keys(cambios).length === 0) {
      return jsonError('No hay cambios que guardar');
    }

    await client.patch(id).set(cambios).commit();

    return jsonOk({ ok: true });
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
