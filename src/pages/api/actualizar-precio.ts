export const prerender = false;
import type { APIRoute } from 'astro';
import { createClient } from '@sanity/client';
import { env } from 'cloudflare:workers';

function pinValido(request: Request) {
  const pin = request.headers.get('x-upload-pin');
  return pin === env.UPLOAD_PIN;
}

export const POST: APIRoute = async ({ request }) => {
  if (!pinValido(request)) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }

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
      return new Response(JSON.stringify({ error: 'Falta id' }), { status: 400 });
    }

    const client = createClient({
      projectId: env.SANITY_PROJECT_ID,
      dataset: 'production',
      apiVersion: '2024-01-01',
      token: env.SANITY_API_TOKEN,
      useCdn: false,
    });

    const cambios: any = {};
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
      return new Response(JSON.stringify({ error: 'No hay cambios que guardar' }), { status: 400 });
    }

    await client.patch(id).set(cambios).commit();

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
