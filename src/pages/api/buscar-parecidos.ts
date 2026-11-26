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

// Escalas, que NO identifican nada: todos los 1:64 del mundo son 1:64.
const ESCALAS = new Set(['1/64', '1/50', '1/43', '1/24', '1/18', '1/87', '1/12']);

/**
 * Numeros de coleccion del empaque: "157/250", "60/100".
 * tokens() los borra antes de comparar, pero son lo UNICO que identifica a carritos cuyo nombre
 * es puro generico: "'17 Ford GT Azul HW Turbo" no tiene ni una palabra propia (ford es marca,
 * 2017 es año, gt y turbo son genericos), y por eso un duplicado real se colaba sin aviso.
 * Dos castings distintos no comparten el mismo numero dentro de la misma serie.
 */
function numerosDeColeccion(texto: string): string[] {
  const salida = new Set<string>();
  for (const m of String(texto || '').matchAll(/\b(\d{1,3})\s*\/\s*(\d{2,3})\b/g)) {
    const par = `${Number(m[1])}/${Number(m[2])}`;
    if (ESCALAS.has(par)) continue;
    if (Number(m[2]) < 20) continue; // 5/10, 7/10: posicion dentro de una subserie, muy debil
    salida.add(par);
  }
  return [...salida];
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
  const numsConsulta = new Set<string>(numerosDeColeccion(`${titulo} ${claves.join(' ')}`));

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
        const numeroComun = numsConsulta.size
          ? numerosDeColeccion(`${p.titulo} ${(p.palabrasClave || []).join(' ')}`).find((n) => numsConsulta.has(n))
          : undefined;
        if (!manual && !codigoComun && !hayDistintiva && !numeroComun) return null;

        let puntaje = comunes.length / toksConsulta.length;
        if (codigoComun) puntaje = Math.min(1, puntaje + 0.5); // el codigo es casi definitivo
        if (numeroComun) puntaje = Math.min(1, puntaje + 0.4); // mismo numero de coleccion: casi seguro

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
          numeroIgual: numeroComun || null,
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
