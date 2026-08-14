export const prerender = false;
import type { APIRoute } from 'astro';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { env } from 'cloudflare:workers';
import { jsonError, jsonOk, verificarAcceso } from '../../lib/api-utils';

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

const ESQUEMA_RESPUESTA = {
  type: SchemaType.OBJECT,
  properties: {
    titulo: { type: SchemaType.STRING },
    marca: { type: SchemaType.STRING, nullable: true },
    descripcion: { type: SchemaType.STRING },
    altTexto: { type: SchemaType.STRING },
    palabrasClave: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    edadRecomendada: { type: SchemaType.STRING, nullable: true },
    capacidad: { type: SchemaType.STRING, nullable: true },
    edicion: { type: SchemaType.STRING, nullable: true },
  },
  required: ['titulo', 'descripcion', 'altTexto', 'palabrasClave'],
};

function construirPrompt(contexto: string | null): string {
  let prompt = `Analiza esta foto de un producto de venta y completa los campos del esquema.\n`;

  if (contexto) {
    prompt += `\nEl vendedor dio este contexto adicional sobre el producto: "${contexto}"\n`;
  }

  prompt += `
Reglas importantes:
- Responde SIEMPRE en español, sin importar el idioma del texto que veas en el empaque, etiqueta o producto.
- descripcion: escribe en tono de venta, resaltando lo atractivo del producto (calidad, diseno, uso, para quien es ideal) sin exagerar ni inventar cualidades que no se ven o no fueron confirmadas. Nada de frases genericas vacias tipo "producto de excelente calidad" - se especifico sobre que lo hace atractivo.
- La descripcion tambien debe ayudar a que la pagina aparezca en buscadores como Google: menciona el tipo de producto, marca y caracteristica principal en la primera oracion, usando el lenguaje natural con el que un comprador buscaria este producto (ej. "portagel antibacterial", "wallflower aromatizante", "hot wheels edicion limitada"). No repitas la misma palabra clave de forma forzada ni antinatural, escribe para un humano primero.
- altTexto: escribe una descripcion breve (maximo 125 caracteres) de LO QUE SE VE EN LA FOTO especificamente - no repitas el titulo tal cual. Menciona color, forma o detalle visible distintivo (ej. "Termo Stanley FlowState azul marino con tapa abatible" en vez de solo "Termo Stanley"). Esto es para el atributo alt de la imagen, pensado para accesibilidad y buscadores de imagenes, no para venta.
- Si el vendedor dio contexto arriba, tratalo como informacion confirmada y usalo con seguridad en la descripcion.
- palabrasClave: usa 5 a 8 terminos ESPECIFICOS que un cliente usaria para buscar este producto exacto (marca, modelo, color, personaje, coleccion, caracteristica distintiva). NO incluyas palabras genericas de categoria como "juguete", "producto", "articulo", "accesorio".
- Los campos marca, edadRecomendada, capacidad y edicion deben ser null si no aplican o no son visibles, a menos que el contexto del vendedor los confirme.`;

  return prompt;
}

export const POST: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'analizar');
  if (bloqueo) return bloqueo;

  const formData = await request.formData();
  const archivo = formData.get('foto') as File | null;
  const contexto = formData.get('contexto') as string | null;

  if (!archivo) {
    return jsonError('No se recibio ninguna foto');
  }

  try {
    const buffer = await archivo.arrayBuffer();
    const base64 = bufferABase64(buffer);

    const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-flash-lite-latest',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ESQUEMA_RESPUESTA as any,
      },
    });

    const imagePart = {
      inlineData: {
        data: base64,
        mimeType: archivo.type || 'image/jpeg',
      },
    };

    const prompt = construirPrompt(contexto);
    const result = await model.generateContent([prompt, imagePart]);
    const datos = JSON.parse(result.response.text());

    return jsonOk(datos);
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
