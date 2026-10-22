// Análisis de producto con Gemini — un solo lugar para el prompt y la llamada.
// Lo usan /api/analizar (Cloudflare Worker) y los scripts de Mac (Node), por eso
// es JavaScript plano y usa fetch directo a la API REST (sin SDK).
//
// Flujo:
// 1. Intenta en UNA llamada: foto + búsqueda de Google + respuesta JSON con esquema.
// 2. Si eso falla (error de la API, JSON roto, la búsqueda no está disponible en tu
//    plan, o tarda demasiado), repite automáticamente SIN búsqueda, como antes.
//    Así nunca se traba una subida.

const MODELO = 'gemini-flash-lite-latest';
const URL_API = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;
const TIEMPO_MAXIMO_CON_BUSQUEDA_MS = 30000;
const TIEMPO_MAXIMO_SIN_BUSQUEDA_MS = 30000;
const MAXIMO_FUENTES = 5;

const TEXTO_NULO = { type: ['string', 'null'] };

const ESQUEMA_RESPUESTA = {
  type: 'object',
  properties: {
    titulo: { type: 'string' },
    marca: TEXTO_NULO,
    descripcion: { type: 'string' },
    altTexto: { type: 'string' },
    palabrasClave: { type: 'array', items: { type: 'string' } },
    edadRecomendada: TEXTO_NULO,
    capacidad: TEXTO_NULO,
    edicion: TEXTO_NULO,
    productoIdentificado: { type: 'string' },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
    datosWeb: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'titulo',
    'descripcion',
    'altTexto',
    'palabrasClave',
    'productoIdentificado',
    'confianza',
    'datosWeb',
  ],
};

const REGLAS_REDACCION = `
Reglas de redaccion:
- Responde SIEMPRE en español, sin importar el idioma de la foto, del empaque o de las fuentes.
- Redacta todo con tus propias palabras. Nunca copies ni parafrasees de cerca frases de Amazon, del fabricante u otra tienda; usa sus datos, no su texto.
- descripcion: escribe en tono de venta, resaltando lo atractivo del producto (calidad, diseño, uso, para quien es ideal) sin exagerar ni inventar cualidades que no se ven o no fueron confirmadas. Nada de frases genericas vacias tipo "producto de excelente calidad" - se especifico sobre que lo hace atractivo.
- La descripcion tambien debe ayudar a que la pagina aparezca en buscadores como Google: menciona el tipo de producto, marca y caracteristica principal en la primera oracion, usando el lenguaje natural con el que un comprador buscaria este producto (ej. "portagel antibacterial", "wallflower aromatizante", "hot wheels edicion limitada"). No repitas la misma palabra clave de forma forzada ni antinatural, escribe para un humano primero.
- altTexto: escribe una descripcion breve (maximo 125 caracteres) de LO QUE SE VE EN LA FOTO especificamente - no repitas el titulo tal cual. Menciona color, forma o detalle visible distintivo (ej. "Termo Stanley FlowState azul marino con tapa abatible" en vez de solo "Termo Stanley"). Esto es para el atributo alt de la imagen, pensado para accesibilidad y buscadores de imagenes, no para venta.
- palabrasClave: usa 5 a 8 terminos ESPECIFICOS que un cliente usaria para buscar este producto exacto (marca, modelo, color, personaje, coleccion, caracteristica distintiva). Incluye el codigo o numero de modelo si lo confirmaste. NO incluyas palabras genericas de categoria como "juguete", "producto", "articulo", "accesorio".`;

function construirPrompt(contexto, conBusqueda) {
  let prompt = `Analiza esta foto de un producto de venta y completa los campos del esquema.\n`;

  if (contexto) {
    prompt += `\nEl vendedor dio este contexto adicional sobre el producto: "${contexto}"\n`;
  }

  prompt += `
PASO 1 - Identifica el producto exacto antes de escribir:
- Lee primero todo lo que sea identificador visible en la foto: marca, nombre del modelo, numero de modelo o SKU, codigo de barras/UPC, numero de coleccion (ej. "123/250"), codigo del juguete (ej. Hot Wheels "HKG45"), serie, año, capacidad o tamaño impreso (ej. "30 oz", "236 ml").
- Si el vendedor dio contexto, usalo como pista principal; es informacion confirmada y tiene prioridad sobre cualquier otra fuente.
`;

  if (conBusqueda) {
    prompt += `
PASO 2 - Busca en Google para confirmar datos:
- Busca usando los identificadores mas especificos que encontraste (codigo o modelo + marca), no descripciones genericas.
- Prefiere como fuente el sitio oficial del fabricante; despues tiendas grandes (Amazon, Walmart, Target) o bases de datos de coleccionistas (ej. Hot Wheels Wiki para autos).
- Solo usa un dato de internet si corresponde a ESTE producto exacto: mismo modelo, misma variante de color y mismo tamaño que se ve en la foto. Si hay varias versiones y no puedes saber cual es, usa solo lo que se ve en la foto.
- Datos utiles que buscar: nombre oficial completo, serie o coleccion, año, medidas, capacidad, material, numero de piezas, edad recomendada del fabricante, caracteristicas funcionales (ej. "doble pared", "libre de BPA", "apto lavavajillas").
- NO tomes de internet: precios, promociones, reseñas, calificaciones, garantias, informacion de envio ni frases de marketing de la tienda.

PASO 3 - Califica que tan seguro estas:
- productoIdentificado: el nombre exacto del producto que confirmaste (ej. "Hot Wheels '71 Datsun 510, HW J-Imports 2024, #45/250").
- confianza: "alta" si un identificador visible (codigo, modelo) coincidio con una fuente; "media" si coincide por marca, diseño y nombre pero sin codigo; "baja" si no encontraste el producto exacto. Si es "baja", no uses datos de internet: escribe solo con lo que se ve en la foto.
- datosWeb: lista corta de los datos que SI tomaste de internet (ej. "capacidad 40 oz", "serie HW J-Imports 2024"), para que el vendedor los revise. Lista vacia si no usaste ninguno.
`;
  } else {
    prompt += `
PASO 2 - En esta ocasion NO tienes acceso a internet: usa solo lo que se ve en la foto y el contexto del vendedor.
- productoIdentificado: el nombre mas exacto que puedas leer en la foto.
- confianza: "baja".
- datosWeb: lista vacia.
`;
  }

  prompt += REGLAS_REDACCION;
  prompt += `
- marca, edadRecomendada, capacidad y edicion: null si no aplican o no se confirmaron (por la foto, el contexto del vendedor${conBusqueda ? ' o una fuente con confianza alta/media' : ''}).

Tu respuesta debe ser UNICAMENTE el objeto JSON del esquema, sin texto antes ni despues.`;

  return prompt;
}

function extraerTexto(candidato) {
  const partes = candidato?.content?.parts || [];
  return partes
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
}

function parsearJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    // A veces el modelo envuelve el JSON en texto o en ```json ... ```
    const inicio = texto.indexOf('{');
    const fin = texto.lastIndexOf('}');
    if (inicio === -1 || fin <= inicio) return null;
    try {
      return JSON.parse(texto.slice(inicio, fin + 1));
    } catch {
      return null;
    }
  }
}

function esRespuestaValida(datos) {
  return (
    datos &&
    typeof datos.titulo === 'string' && datos.titulo.trim() !== '' &&
    typeof datos.descripcion === 'string' && datos.descripcion.trim() !== '' &&
    typeof datos.altTexto === 'string' &&
    Array.isArray(datos.palabrasClave)
  );
}

function extraerFuentes(candidato) {
  const trozos = candidato?.groundingMetadata?.groundingChunks || [];
  const vistas = new Set();
  const fuentes = [];
  for (const trozo of trozos) {
    const web = trozo?.web;
    if (!web?.uri || !/^https?:\/\//i.test(web.uri)) continue;
    const titulo = web.title || web.domain || 'fuente';
    if (vistas.has(titulo)) continue;
    vistas.add(titulo);
    fuentes.push({ titulo, url: web.uri });
    if (fuentes.length >= MAXIMO_FUENTES) break;
  }
  return fuentes;
}

async function llamarGemini({ apiKey, imagenBase64, mimeType, contexto, conBusqueda }) {
  const cuerpo = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: construirPrompt(contexto, conBusqueda) },
          { inline_data: { mime_type: mimeType, data: imagenBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: ESQUEMA_RESPUESTA,
    },
  };
  if (conBusqueda) {
    cuerpo.tools = [{ google_search: {} }];
  }

  const respuesta = await fetch(URL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(conBusqueda ? TIEMPO_MAXIMO_CON_BUSQUEDA_MS : TIEMPO_MAXIMO_SIN_BUSQUEDA_MS),
  });

  const json = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const mensaje = json?.error?.message || `HTTP ${respuesta.status}`;
    throw new Error(`Gemini respondio con error: ${mensaje}`);
  }

  const candidato = json?.candidates?.[0];
  const datos = parsearJson(extraerTexto(candidato));
  if (!esRespuestaValida(datos)) {
    throw new Error('Gemini devolvio una respuesta incompleta o con JSON roto');
  }

  return { datos, fuentes: conBusqueda ? extraerFuentes(candidato) : [] };
}

function normalizar(datos, fuentes, busquedaUsada) {
  const confianzasValidas = ['alta', 'media', 'baja'];
  return {
    titulo: datos.titulo.trim(),
    marca: datos.marca || null,
    descripcion: datos.descripcion.trim(),
    altTexto: datos.altTexto.trim(),
    palabrasClave: datos.palabrasClave.filter((p) => typeof p === 'string' && p.trim() !== ''),
    edadRecomendada: datos.edadRecomendada || null,
    capacidad: datos.capacidad || null,
    edicion: datos.edicion || null,
    productoIdentificado: (datos.productoIdentificado || datos.titulo).trim(),
    confianza: busquedaUsada && confianzasValidas.includes(datos.confianza) ? datos.confianza : 'baja',
    datosWeb: busquedaUsada && Array.isArray(datos.datosWeb) ? datos.datosWeb : [],
    fuentes,
    busquedaUsada,
  };
}

/**
 * Analiza la foto de un producto. Primero intenta con búsqueda en Google; si falla,
 * repite solo con la foto.
 *
 * @param {object} opciones
 * @param {string} opciones.apiKey - GEMINI_API_KEY
 * @param {string} opciones.imagenBase64 - la foto en base64 (sin el prefijo data:)
 * @param {string} [opciones.mimeType] - por defecto image/jpeg
 * @param {string|null} [opciones.contexto] - texto opcional del vendedor
 * @param {boolean} [opciones.buscarEnWeb] - false para saltarse la búsqueda
 * @returns {Promise<object>} campos del producto + productoIdentificado, confianza,
 *   datosWeb, fuentes [{titulo, url}], busquedaUsada, y avisoBusqueda si hubo plan B.
 */
export async function analizarProducto({
  apiKey,
  imagenBase64,
  mimeType = 'image/jpeg',
  contexto = null,
  buscarEnWeb = true,
}) {
  if (!apiKey) throw new Error('Falta GEMINI_API_KEY');

  let avisoBusqueda = null;

  if (buscarEnWeb) {
    try {
      const { datos, fuentes } = await llamarGemini({ apiKey, imagenBase64, mimeType, contexto, conBusqueda: true });
      return normalizar(datos, fuentes, true);
    } catch (error) {
      avisoBusqueda = `La busqueda web fallo (${error.message}); se uso solo la foto.`;
    }
  }

  const { datos } = await llamarGemini({ apiKey, imagenBase64, mimeType, contexto, conBusqueda: false });
  const resultado = normalizar(datos, [], false);
  if (avisoBusqueda) resultado.avisoBusqueda = avisoBusqueda;
  return resultado;
}
