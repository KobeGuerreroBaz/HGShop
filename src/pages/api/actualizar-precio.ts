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
      titulo?: string;
      slug?: string;
    };
    const { id, precio, cantidad, marca, palabrasClave, mostrarExistencias, agotado, titulo, slug } = datos;

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
    if (typeof titulo === 'string' && titulo.trim()) {
      cambios.titulo = titulo.trim().slice(0, 200);
    }
    // El slug es la dirección de la ficha: hgstoremx.com/productos/<slug>/.
    // Cambiarlo rompe el enlace viejo (queda 404), así que solo se toca a propósito,
    // y nunca se permite uno que ya use otro producto: eso deja a uno sin ficha.
    if (typeof slug === 'string' && slug.trim()) {
      const limpio = slug
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      if (limpio.length < 3) {
        return jsonError('La dirección es demasiado corta');
      }
      const dueno: string | null = await client.fetch(
        '*[_type == "producto" && slug.current == $slug][0]._id',
        { slug: limpio }
      );
      if (dueno && dueno !== id) {
        return jsonError(`Esa dirección ya la usa otro producto (${limpio}). Ponle algo que la distinga.`);
      }
      cambios.slug = { _type: 'slug', current: limpio };
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
