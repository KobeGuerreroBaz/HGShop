export const prerender = false;
import type { APIRoute } from 'astro';
import { createClient } from '@sanity/client';
import { env } from 'cloudflare:workers';
import { nombreDepartamento } from '../../lib/sanity';

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
    const departamentos: string[] = await client.fetch(
      `array::unique(*[_type == "producto" && !defined(precio) && defined(categoria->departamento)].categoria->departamento)`
    );

    const resultado = departamentos
      .map((slug) => ({ slug, nombre: nombreDepartamento(slug) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

    return new Response(JSON.stringify(resultado), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
