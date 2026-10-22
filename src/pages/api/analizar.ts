export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError, jsonOk, verificarAcceso } from '../../lib/api-utils';
// @ts-ignore - módulo JS compartido con los scripts de Mac
import { analizarProducto } from '../../lib/gemini-producto.mjs';

function bufferABase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const tamanoBloque = 8192;
  let binario = '';
  for (let i = 0; i < bytes.length; i += tamanoBloque) {
    const bloque = bytes.subarray(i, i + tamanoBloque);
    binario += String.fromCharCode(...bloque);
  }
  return btoa(binario);
}

export const POST: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'analizar');
  if (bloqueo) return bloqueo;

  const formData = await request.formData();
  const archivo = formData.get('foto') as File | null;
  const contextoCrudo = formData.get('contexto') as string | null;
  const contexto = contextoCrudo && contextoCrudo.trim() !== '' ? contextoCrudo.trim() : null;

  if (!archivo) {
    return jsonError('No se recibio ninguna foto');
  }

  try {
    const buffer = await archivo.arrayBuffer();
    const datos = await analizarProducto({
      apiKey: env.GEMINI_API_KEY,
      imagenBase64: bufferABase64(buffer),
      mimeType: archivo.type || 'image/jpeg',
      contexto,
    });

    return jsonOk(datos);
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
