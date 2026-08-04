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

  const departamento = url.searchParams.get('departamento');

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

    const productosConImagen = productos.map((p: any) => ({
      ...p,
      imagenUrl: p.imagenPrincipal ? urlFor(p.imagenPrincipal).width(800).url() : null,
    }));

    return new Response(JSON.stringify(productosConImagen), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
