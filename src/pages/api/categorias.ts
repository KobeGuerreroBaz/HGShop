export const prerender = false;
import type { APIRoute } from 'astro';
import { createClient } from '@sanity/client';
import { env } from 'cloudflare:workers';

function pinValido(request: Request) {
  const pin = request.headers.get('x-upload-pin');
  return pin === env.UPLOAD_PIN;
}

export const GET: APIRoute = async ({ request }) => {
  if (!pinValido(request)) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }

  const client = createClient({
    projectId: env.SANITY_PROJECT_ID,
    dataset: 'production',
    apiVersion: '2024-01-01',
    token: env.SANITY_API_TOKEN,
    useCdn: false,
  });

  try {
    const categorias = await client.fetch(`
      *[_type == "categoria" && defined(departamento)]{
        _id,
        titulo,
        departamento
      } | order(departamento asc, titulo asc)
    `);

    return new Response(JSON.stringify(categorias), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
