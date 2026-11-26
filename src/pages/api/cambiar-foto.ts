export const prerender = false;
import type { APIRoute } from 'astro';
import imageUrlBuilder from '@sanity/image-url';
import { jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';

/**
 * Cambia las fotos de un producto ya publicado, desde /inventario.
 *
 * Nunca toca el slug: la dirección de la ficha (hgstoremx.com/productos/<slug>/)
 * se queda igual, así no se pierde lo que haya ganado en Google aunque la foto
 * sea otra. Sí actualiza `hashFoto` al reemplazar la principal, porque ese hash
 * es el que usa el detector de duplicados al subir productos nuevos: si se
 * quedara con el de la foto vieja, avisaría de una foto que ya no existe.
 *
 * Modos:
 *  - principal        (multipart) reemplaza imagenPrincipal; opcionalmente manda la vieja a la galería
 *  - agregar-galeria   (multipart) agrega una foto al array galeria
 *  - quitar-galeria    (JSON)      quita una foto de la galeria por su llave
 */

const TAMANO_MAXIMO = 10 * 1024 * 1024; // 10 MB: el navegador ya manda la foto comprimida (~300 KB)
const MAXIMO_GALERIA = 12;
const ANCHO_TARJETA = 600; // la tarjeta de /inventario en pantalla retina
const ANCHO_MINIATURA = 200;

type FotoSanity = { _type?: string; _key?: string; asset?: { _type?: string; _ref?: string } };

function nuevaLlave(): string {
  return `foto-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** Toda foto de la galería necesita _key; las viejas subidas por script pueden no tenerla. */
function conLlaves(galeria: FotoSanity[]): FotoSanity[] {
  return galeria
    .filter((foto) => foto?.asset?._ref)
    .map((foto) => ({
      _type: 'image',
      _key: foto._key || nuevaLlave(),
      asset: { _type: 'reference', _ref: foto.asset!._ref },
    }));
}

export const POST: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'cambiar-foto');
  if (bloqueo) return bloqueo;

  try {
    const client = sanityClientEscritura();
    const builder = imageUrlBuilder(client);
    const urlDe = (fuente: unknown, ancho: number) => builder.image(fuente as any).width(ancho).auto('format').url();
    const paraPantalla = (galeria: FotoSanity[]) =>
      galeria.map((foto) => ({ llave: foto._key as string, url: urlDe(foto, ANCHO_MINIATURA) }));

    const tipoContenido = request.headers.get('content-type') || '';

    // ---- Quitar una foto de la galería (no sube nada, por eso va en JSON) ----
    if (tipoContenido.includes('application/json')) {
      const { id, llave } = (await request.json()) as { id?: string; llave?: string };
      if (!id) return jsonError('Falta id');
      if (!llave) return jsonError('Falta la llave de la foto');

      const actual = await client.fetch<{ galeria?: FotoSanity[] } | null>(
        '*[_type == "producto" && _id == $id][0]{galeria}',
        { id }
      );
      if (!actual) return jsonError('No encontré ese producto');

      const galeriaCruda = (actual.galeria || []).filter((foto) => foto?.asset?._ref);
      let indice = galeriaCruda.findIndex((foto) => foto._key === llave);
      if (indice < 0 && llave.startsWith('idx-')) {
        const posicion = Number(llave.slice(4));
        if (Number.isInteger(posicion) && posicion >= 0 && posicion < galeriaCruda.length) indice = posicion;
      }
      if (indice < 0) return jsonError('Esa foto ya no está en la galería');

      const quedan = conLlaves(galeriaCruda.filter((_, i) => i !== indice));
      await client.patch(id).set({ galeria: quedan }).commit();
      return jsonOk({ ok: true, galeria: paraPantalla(quedan) });
    }

    // ---- Subir foto (principal o galería) ----
    const formData = await request.formData();
    const id = formData.get('id') as string | null;
    const modo = formData.get('modo') as string | null;
    const foto = formData.get('foto') as File | null;
    const hash = formData.get('hash') as string | null;
    const conservarVieja = formData.get('conservarVieja') === '1';

    if (!id) return jsonError('Falta id');
    if (modo !== 'principal' && modo !== 'agregar-galeria') return jsonError('Modo no válido');
    if (!foto || !(foto instanceof File) || foto.size === 0) return jsonError('Falta la foto');
    if (foto.size > TAMANO_MAXIMO) return jsonError('La foto pesa demasiado');

    const actual = await client.fetch<{ imagenPrincipal?: FotoSanity; galeria?: FotoSanity[] } | null>(
      '*[_type == "producto" && _id == $id][0]{imagenPrincipal, galeria}',
      { id }
    );
    if (!actual) return jsonError('No encontré ese producto');

    const galeria = conLlaves(actual.galeria || []);

    if (modo === 'agregar-galeria' && galeria.length >= MAXIMO_GALERIA) {
      return jsonError(`La galería ya tiene ${MAXIMO_GALERIA} fotos; quita una primero`);
    }

    const buffer = await foto.arrayBuffer();
    // Sanity reusa el asset si la foto es idéntica a una que ya está subida.
    const asset = await client.assets.upload('image', new Uint8Array(buffer) as any, {
      filename: foto.name || 'foto.jpg',
    });

    const yaEnGaleria = (ref: string) => galeria.some((f) => f.asset?._ref === ref);

    if (modo === 'agregar-galeria') {
      if (actual.imagenPrincipal?.asset?._ref === asset._id) {
        return jsonError('Esa foto ya es la principal de este producto');
      }
      if (yaEnGaleria(asset._id)) {
        return jsonError('Esa foto ya está en la galería');
      }
      galeria.push({ _type: 'image', _key: nuevaLlave(), asset: { _type: 'reference', _ref: asset._id } });
      await client.patch(id).set({ galeria }).commit();
      return jsonOk({ ok: true, galeria: paraPantalla(galeria) });
    }

    // modo === 'principal'
    const refVieja = actual.imagenPrincipal?.asset?._ref;
    const nuevaPrincipal = { _type: 'image', asset: { _type: 'reference', _ref: asset._id } };
    const cambios: Record<string, unknown> = { imagenPrincipal: nuevaPrincipal };
    if (hash) cambios.hashFoto = hash;

    let seGuardoVieja = false;
    if (
      conservarVieja &&
      refVieja &&
      refVieja !== asset._id && // misma foto otra vez: no hay nada que conservar
      !yaEnGaleria(refVieja) &&
      galeria.length < MAXIMO_GALERIA
    ) {
      galeria.push({ _type: 'image', _key: nuevaLlave(), asset: { _type: 'reference', _ref: refVieja } });
      seGuardoVieja = true;
    }

    // Se guarda la galería normalizada (con _key en todas) aunque no se haya agregado
    // nada: así las fotos viejas subidas por script quedan con llave y se pueden quitar.
    if (galeria.length > 0) cambios.galeria = galeria;

    await client.patch(id).set(cambios).commit();

    return jsonOk({
      ok: true,
      imagenUrl: urlDe(nuevaPrincipal, ANCHO_TARJETA),
      galeria: paraPantalla(galeria),
      seGuardoVieja,
    });
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
