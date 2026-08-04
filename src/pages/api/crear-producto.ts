export const prerender = false;
import type { APIRoute } from 'astro';
import { createClient } from '@sanity/client';
import { env } from 'cloudflare:workers';

function pinValido(request: Request) {
  const pin = request.headers.get('x-upload-pin');
  return pin === env.UPLOAD_PIN;
}

function generarSlug(texto: string) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function sufijoUnico(assetId: string) {
  return assetId.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
}

export const POST: APIRoute = async ({ request }) => {
  if (!pinValido(request)) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }

  try {
    const formData = await request.formData();

    const fotoPrincipal = formData.get('fotoPrincipal') as File;
    const fotosGaleria = formData.getAll('fotoGaleria') as File[];
    const titulo = formData.get('titulo') as string;
    const descripcion = formData.get('descripcion') as string;
    const altTexto = formData.get('altTexto') as string | null;
    const palabrasClave = JSON.parse((formData.get('palabrasClave') as string) || '[]');
    const marca = formData.get('marca') as string | null;
    const capacidad = formData.get('capacidad') as string | null;
    const edicion = formData.get('edicion') as string | null;
    const edadRecomendada = formData.get('edadRecomendada') as string | null;
    const categoriaId = formData.get('categoriaId') as string;
    const precioTexto = formData.get('precio') as string | null;
    const cantidadTexto = formData.get('cantidad') as string | null;
    const hash = formData.get('hash') as string;

    const client = createClient({
      projectId: env.SANITY_PROJECT_ID,
      dataset: 'production',
      apiVersion: '2024-01-01',
      token: env.SANITY_API_TOKEN,
      useCdn: false,
    });

    const bufferPrincipal = await fotoPrincipal.arrayBuffer();
    const assetPrincipal = await client.assets.upload('image', new Uint8Array(bufferPrincipal) as any, {
      filename: fotoPrincipal.name || 'foto.jpg',
    });

    const assetsGaleria = [];
    for (const foto of fotosGaleria) {
      const buffer = await foto.arrayBuffer();
      const asset = await client.assets.upload('image', new Uint8Array(buffer) as any, {
        filename: foto.name || 'foto-galeria.jpg',
      });
      assetsGaleria.push(asset);
    }

    const slugFinal = `${generarSlug(titulo)}-${sufijoUnico(assetPrincipal._id)}`;

    const documento: any = {
      _type: 'producto',
      titulo,
      slug: { _type: 'slug', current: slugFinal },
      estado: 'Nuevo',
      descripcion,
      imagenPrincipal: {
        _type: 'image',
        asset: { _type: 'reference', _ref: assetPrincipal._id },
      },
      categoria: { _type: 'reference', _ref: categoriaId },
      palabrasClave,
      hashFoto: hash,
    };

    if (assetsGaleria.length > 0) {
      documento.galeria = assetsGaleria.map((asset) => ({
        _type: 'image',
        _key: asset._id,
        asset: { _type: 'reference', _ref: asset._id },
      }));
    }

    if (precioTexto) documento.precio = Number(precioTexto);
    if (cantidadTexto) documento.cantidadDisponible = Number(cantidadTexto);
    if (marca) documento.marca = marca;
    if (capacidad) documento.capacidad = capacidad;
    if (edicion) documento.edicion = edicion;
    if (edadRecomendada) documento.edadRecomendada = edadRecomendada;
    if (altTexto) documento.altTexto = altTexto;

    const creado = await client.create(documento);

    return new Response(JSON.stringify({ ok: true, id: creado._id, slug: slugFinal }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
