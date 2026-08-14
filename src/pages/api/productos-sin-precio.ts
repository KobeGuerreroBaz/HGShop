export const prerender = false;
import type { APIRoute } from 'astro';
import imageUrlBuilder from '@sanity/image-url';
import { jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';
import type { ProductoParaAdmin } from '../../lib/tipos';

export const GET: APIRoute = async ({ request, url }) => {
  const bloqueo = await verificarAcceso(request, 'productos-sin-precio');
  if (bloqueo) return bloqueo;

  const departamento = url.searchParams.get('departamento');

  const client = sanityClientEscritura();

  const builder = imageUrlBuilder(client);
  function urlFor(source: any) {
    return builder.image(source);
  }

  try {
    const filtroDepartamento = departamento ? '&& categoria->departamento == $departamento' : '';

    const productos = await client.fetch(
      `*[_type == "producto" && !defined(precio) ${filtroDepartamento}]{
        _id,
        titulo,
        imagenPrincipal,
        cantidadDisponible,
        marca,
        palabrasClave,
        mostrarExistencias,
        agotado,
        "categoriaTitulo": categoria->titulo
      } | order(_createdAt asc)`,
      departamento ? { departamento } : {}
    );

    const productosConImagen: ProductoParaAdmin[] = productos.map((p: any) => ({
      _id: p._id,
      titulo: p.titulo,
      cantidadDisponible: p.cantidadDisponible,
      marca: p.marca,
      palabrasClave: p.palabrasClave,
      mostrarExistencias: p.mostrarExistencias,
      agotado: p.agotado,
      categoriaTitulo: p.categoriaTitulo,
      // 300px alcanza para la tarjeta de ~130px del grid de 3 columnas en /precios;
      // .auto('format') deja que Sanity sirva WebP/AVIF en vez del original.
      imagenUrl: p.imagenPrincipal ? urlFor(p.imagenPrincipal).width(300).auto('format').url() : null,
    }));

    return jsonOk(productosConImagen);
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
