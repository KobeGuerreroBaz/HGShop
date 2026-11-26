export const prerender = false;
import type { APIRoute } from 'astro';
import imageUrlBuilder from '@sanity/image-url';
import { galeriaParaPantalla, jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';
import type { ProductoParaAdmin } from '../../lib/tipos';

export const GET: APIRoute = async ({ request, url }) => {
  const bloqueo = await verificarAcceso(request, 'buscar-productos');
  if (bloqueo) return bloqueo;

  const q = url.searchParams.get('q') || '';
  if (q.trim().length < 2) {
    return jsonOk([]);
  }

  const client = sanityClientEscritura();

  const builder = imageUrlBuilder(client);
  function urlFor(source: any) {
    return builder.image(source);
  }

  try {
    const patron = `*${q.trim()}*`;

    const productos = await client.fetch(
      `*[_type == "producto" && titulo match $patron]{
        _id,
        titulo,
        "slug": slug.current,
        precio,
        cantidadDisponible,
        marca,
        palabrasClave,
        mostrarExistencias,
        agotado,
        altTexto,
        imagenPrincipal,
        galeria,
        "categoriaTitulo": categoria->titulo,
        "categoriaId": categoria._ref,
        "departamento": categoria->departamento
      } | order(titulo asc) [0...20]`,
      { patron }
    );

    const productosConImagen: ProductoParaAdmin[] = productos.map((p: any) => ({
      _id: p._id,
      titulo: p.titulo,
      slug: p.slug,
      precio: p.precio,
      cantidadDisponible: p.cantidadDisponible,
      marca: p.marca,
      palabrasClave: p.palabrasClave,
      mostrarExistencias: p.mostrarExistencias,
      agotado: p.agotado,
      categoriaTitulo: p.categoriaTitulo,
      categoriaId: p.categoriaId,
      departamento: p.departamento,
      altTexto: p.altTexto,
      imagenUrl: p.imagenPrincipal ? urlFor(p.imagenPrincipal).width(200).auto('format').url() : null,
      galeria: galeriaParaPantalla(p.galeria, urlFor),
    }));

    return jsonOk(productosConImagen);
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
