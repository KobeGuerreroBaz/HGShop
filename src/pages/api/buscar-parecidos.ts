export const prerender = false;
import type { APIRoute } from 'astro';
import imageUrlBuilder from '@sanity/image-url';
import { jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';
// @ts-ignore - modulo en JavaScript plano, sin tipos
import { tokens, distintivas } from '../../lib/emparejar-precios.mjs';

// ---------------------------------------------------------------------------
// Busca en el catalogo productos parecidos a uno que se esta por subir, para
// avisar si ya existe. Lo usa el componente AvisoDuplicados.astro.
//
// Se apoya en tokens() y distintivas() de emparejar-precios.mjs (el mismo motor
// sin IA que empareja carritos con la base de precios): quita "Hot Wheels", los
// colores y el relleno, y deja solo las palabras que de verdad identifican.
//
// A diferencia de buscar-productos (que es para /inventario y busca por titulo),
// esta ruta tambien busca en palabrasClave, que es donde vive el codigo del
// empaque (HLH72, DKL20). No modifica nada: solo lee.
// ---------------------------------------------------------------------------

const MAX_CANDIDATOS = 60;
const MAX_RESULTADOS = 5;
const MAX_RESULTADOS_MANUAL = 10; // buscando a mano se quiere ver la lista, no solo lo mas parecido
const PUNTAJE_MINIMO = 0.2;

/** Un codigo de empaque: mezcla letras y numeros, 4 o mas caracteres (hlh72, dkl20). */
function esCodigo(t: string): boolean {
  return t.length >= 4 && /[a-z]/.test(t) && /\d/.test(t);
}

export const POST: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'buscar-parecidos');
  if (bloqueo) return bloqueo;

  let cuerpo: { titulo?: string; palabrasClave?: string[]; excluirId?: string; modo?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return jsonError('Cuerpo invalido', 400);
  }

  // "auto" = el aviso despues de analizar la foto: exige que coincida algo que identifique el
  // modelo, para que un Porsche no arrastre todos los Porsche del catalogo.
  // "manual" = el buscador de arriba, donde tu escribes: ahi SI quieres ver todos los Volkswagen
  // al escribir "Volkswagen". Antes los dos usaban la regla estricta y por eso buscar una marca
  // sola no devolvia nada.
  const manual = cuerpo.modo === 'manual';
  const titulo = (cuerpo.titulo || '').trim();
  const claves = Array.isArray(cuerpo.palabrasClave) ? cuerpo.palabrasClave : [];
  if (titulo.length < 2 && claves.length === 0) return jsonOk([]);

  const toksConsulta: string[] = tokens(`${titulo} ${claves.join(' ')}`);
  const buscables = toksConsulta.filter((t) => t.length >= 3);
  if (buscables.length === 0) return jsonOk([]);

  const distConsulta = new Set<string>(distintivas(toksConsulta));

  try {
    const client = sanityClientEscritura();
    const builder = imageUrlBuilder(client);

    const candidatos = await client.fetch(
      `*[_type == "producto" && defined(imagenPrincipal) &&
         (titulo match $patrones || palabrasClave[] match $patrones)]{
        _id, titulo, palabrasClave, agotado, cantidadDisponible, precio,
        "slug": slug.current,
        imagenPrincipal,
        "categoriaTitulo": categoria->titulo,
        "departamento": categoria->departamento
      }[0...$tope]`,
      { patrones: buscables.map((t) => `*${t}*`), tope: manual ? MAX_CANDIDATOS * 3 : MAX_CANDIDATOS }
    );

    const puntuados = candidatos
      .map((p: any) => {
        const toksCand: string[] = tokens(`${p.titulo} ${(p.palabrasClave || []).join(' ')}`);
        const setCand = new Set(toksCand);
        const comunes = toksConsulta.filter((t) => setCand.has(t));
        if (comunes.length === 0) return null;

        // Tiene que coincidir algo que identifique el modelo, no solo la marca:
        // asi un "Porsche 911 GT3" no arrastra todos los Porsche del catalogo.
        const codigoComun = comunes.find(esCodigo);
        const hayDistintiva = comunes.some((t) => distConsulta.has(t));
        if (!manual && !codigoComun && !hayDistintiva) return null;

        let puntaje = comunes.length / toksConsulta.length;
        if (codigoComun) puntaje = Math.min(1, puntaje + 0.5); // el codigo es casi definitivo

        return {
          _id: p._id,
          titulo: p.titulo,
          slug: p.slug || null,
          departamento: p.departamento || null,
          categoriaTitulo: p.categoriaTitulo || null,
          agotado: !!p.agotado,
          cantidadDisponible: p.cantidadDisponible ?? null,
          precio: p.precio ?? null,
          imagenUrl: builder.image(p.imagenPrincipal).width(160).auto('format').url(),
          puntaje: Math.round(puntaje * 100),
          codigoIgual: codigoComun || null,
          coincidencias: comunes,
        };
      })
      .filter((r: any) => r && r.puntaje >= PUNTAJE_MINIMO * 100)
      .sort((a: any, b: any) => b.puntaje - a.puntaje)
      .slice(0, manual ? MAX_RESULTADOS_MANUAL : MAX_RESULTADOS);

    return jsonOk(puntuados);
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
