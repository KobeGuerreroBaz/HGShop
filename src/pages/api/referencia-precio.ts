export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';
// @ts-ignore - módulos JS compartidos con los scripts de Mac
import { buscarReferenciaPrecio } from '../../lib/gemini-producto.mjs';
// @ts-ignore
import { esFlujoValido, flujoParaDepartamento } from '../../lib/flujos-precio.mjs';

// Busca la referencia de precio (solo autos a escala, juguetes y Pokémon).
// - Desde /subir: manda el flujo que clasificó Gemini; la referencia se guarda al crear el producto.
// - Desde /inventario: manda productoId + departamento; la referencia se guarda aquí mismo
//   en el campo interno referenciaPrecio (nunca visible al público).
export const POST: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'referencia-precio');
  if (bloqueo) return bloqueo;

  try {
    const datos = (await request.json()) as {
      flujo?: string;
      departamento?: string;
      productoId?: string;
      titulo?: string;
      productoIdentificado?: string;
      marca?: string;
      edicion?: string;
      palabrasClave?: string[];
      alertaValor?: string;
    };

    // El departamento elegido manda sobre la clasificación automática.
    const flujo = flujoParaDepartamento(datos.departamento) || (esFlujoValido(datos.flujo) ? datos.flujo : null);
    if (!flujo) return jsonError('Este tipo de producto no usa búsqueda de precio');
    if (!datos.titulo?.trim() && !datos.productoIdentificado?.trim()) return jsonError('Falta el nombre del producto');

    const referencia = await buscarReferenciaPrecio({
      apiKey: env.GEMINI_API_KEY,
      flujo,
      producto: {
        titulo: (datos.titulo || '').slice(0, 200),
        productoIdentificado: (datos.productoIdentificado || '').slice(0, 200),
        marca: (datos.marca || '').slice(0, 80),
        edicion: (datos.edicion || '').slice(0, 120),
        palabrasClave: Array.isArray(datos.palabrasClave) ? datos.palabrasClave.slice(0, 12).map(String) : [],
        alertaValor: (datos.alertaValor || '').slice(0, 240),
      },
    });

    if (datos.productoId && referencia) {
      await sanityClientEscritura().patch(datos.productoId).set({ referenciaPrecio: referencia }).commit();
    }

    return jsonOk(referencia);
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
