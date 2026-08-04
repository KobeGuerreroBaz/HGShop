export const prerender = false;
import type { APIRoute } from 'astro';
import { createClient } from '@sanity/client';
import { env } from 'cloudflare:workers';
import imageUrlBuilder from '@sanity/image-url';

function pinValido(request: Request) {
  const pin = request.headers.get('x-upload-pin');
  return pin === env.UPLOAD_PIN;
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!pinValido(request)) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }

  const q = url.searchParams.get('q') || '';
  if (q.trim().length < 2) {
    return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
  }

  const client = createClient({
    projectId: env.SANITY_PROJECT_ID,
    dataset: 'production',
    apiVersion: '2024-01-01',
    token: env.SANITY_API_TOKEN,
    useCdn: false,
  });

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
        precio,
        cantidadDisponible,
        marca,
        palabrasClave,
        mostrarExistencias,
        agotado,
        imagenPrincipal,
        "categoriaTitulo": categoria->titulo
      } | order(titulo asc) [0...20]`,
      { patron }
    );

    const productosConImagen = productos.map((p: any) => ({
      ...p,
      imagenUrl: p.imagenPrincipal ? urlFor(p.imagenPrincipal).width(200).url() : null,
    }));

    return new Response(JSON.stringify(productosConImagen), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
