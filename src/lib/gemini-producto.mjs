// Análisis de producto con Gemini — un solo lugar para el prompt y la llamada.
// Lo usan /api/analizar (Cloudflare Worker) y los scripts de Mac (Node), por eso
// es JavaScript plano y usa fetch directo a la API REST (sin SDK).
//
// Flujo:
// 1. Intenta en UNA llamada: foto + búsqueda de Google + respuesta JSON con esquema,
//    con el modelo fijo y el nivel de pensamiento de abajo.
// 2. Si eso falla (error de la API, JSON roto, la búsqueda no está disponible en tu
//    plan, o tarda demasiado), repite automáticamente SIN búsqueda y con la
//    configuración original (alias "latest", pensamiento por defecto).
//    Así nunca se traba una subida.

// Modelo fijo: no cambia solo cuando Google saca una versión nueva.
// Para probar otro modelo, cámbialo aquí (ej. 'gemini-3.8-flash').
const MODELO = 'gemini-3.5-flash-lite';

// Cuánto "razona" antes de contestar: 'minimal' | 'low' | 'medium' | 'high'.
// Más nivel = más cuidadoso, pero más lento y más caro. Pon null para usar el
// valor por defecto del modelo.
const NIVEL_PENSAMIENTO = 'low';

// Plan B: la misma configuración que funcionaba antes de estos ajustes.
const MODELO_RESPALDO = 'gemini-flash-lite-latest';

const urlModelo = (modelo) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
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
Reglas de redacción:
- Responde SIEMPRE en español, sin importar el idioma de la foto, del empaque o de las fuentes.
- Escribe con ortografía correcta en español: acentos (á, é, í, ó, ú), ñ, ü y signos de apertura (¿ ¡). Ejemplos: "colección", "diseño", "acción", "metálicos", "automóviles", "superhéroes", "niños". Nunca omitas un acento ni cambies la ñ por n. Esto aplica a titulo, descripcion, altTexto y palabrasClave.
- Redacta todo con tus propias palabras. Nunca copies ni parafrasees de cerca frases de Amazon, del fabricante u otra tienda; usa sus datos, no su texto.
- descripcion: escribe en tono de venta, resaltando lo atractivo del producto (calidad, diseño, uso, para quién es ideal) sin exagerar ni inventar cualidades que no se ven o no fueron confirmadas. Nada de frases genéricas vacías tipo "producto de excelente calidad"; sé específico sobre qué lo hace atractivo.
- La descripción también debe ayudar a que la página aparezca en buscadores como Google: menciona el tipo de producto, la marca y la característica principal en la primera oración, usando el lenguaje natural con el que un comprador buscaría este producto (ej. "portagel antibacterial", "wallflower aromatizante", "hot wheels edición limitada"). No repitas la misma palabra clave de forma forzada ni antinatural; escribe primero para un humano.
- altTexto: escribe una descripción breve (máximo 125 caracteres) de LO QUE SE VE EN LA FOTO específicamente; no repitas el título tal cual. Menciona color, forma o detalle visible distintivo (ej. "Termo Stanley FlowState azul marino con tapa abatible" en vez de solo "Termo Stanley"). Es para el atributo alt de la imagen, pensado para accesibilidad y buscadores de imágenes, no para venta.
- palabrasClave: usa 5 a 8 términos ESPECÍFICOS que un cliente usaría para buscar este producto exacto (marca, modelo, color, personaje, colección, característica distintiva). Incluye el código o número de modelo si lo confirmaste. NO incluyas palabras genéricas de categoría como "juguete", "producto", "artículo", "accesorio".`;

function construirPrompt(contexto, conBusqueda) {
  let prompt = `Analiza esta foto de un producto de venta y completa los campos del esquema.\n`;

  if (contexto) {
    prompt += `\nEl vendedor dio este contexto adicional sobre el producto: "${contexto}"\n`;
  }

  prompt += `
PASO 1 - Identifica el producto exacto antes de escribir:
- Lee primero todo lo que sea identificador visible en la foto: marca, nombre del modelo, número de modelo o SKU, código de barras/UPC, número de colección (ej. "123/250"), código del juguete (ej. Hot Wheels "HKG45"), serie, año, capacidad o tamaño impreso (ej. "30 oz", "236 ml").
- Si el vendedor dio contexto, úsalo como pista principal; es información confirmada y tiene prioridad sobre cualquier otra fuente.
`;

  if (conBusqueda) {
    prompt += `
PASO 2 - Busca en Google para confirmar datos:
- Busca usando los identificadores más específicos que encontraste (código o modelo + marca), no descripciones genéricas.
- Prefiere como fuente el sitio oficial del fabricante; después tiendas grandes (Amazon, Walmart, Target) o bases de datos de coleccionistas (ej. Hot Wheels Wiki para autos).
- Solo usa un dato de internet si corresponde a ESTE producto exacto: mismo modelo, misma variante de color y mismo tamaño que se ve en la foto. Si hay varias versiones y no puedes saber cuál es, usa solo lo que se ve en la foto.
- Datos útiles que buscar: nombre oficial completo, serie o colección, año, medidas, capacidad, material, número de piezas, edad recomendada del fabricante, características funcionales (ej. "doble pared", "libre de BPA", "apto para lavavajillas").
- NO tomes de internet: precios, promociones, reseñas, calificaciones, garantías, información de envío ni frases de marketing de la tienda.

PASO 3 - Califica qué tan seguro estás:
- productoIdentificado: el nombre exacto del producto que confirmaste (ej. "Hot Wheels '71 Datsun 510, HW J-Imports 2024, #45/250").
- confianza: "alta" si un identificador visible (código, modelo) coincidió con una fuente; "media" si coincide por marca, diseño y nombre pero sin código; "baja" si no encontraste el producto exacto. Si es "baja", no uses datos de internet: escribe solo con lo que se ve en la foto.
- datosWeb: lista corta de los datos que SÍ tomaste de internet (ej. "capacidad 40 oz", "serie HW J-Imports 2024"), para que el vendedor los revise. Lista vacía si no usaste ninguno.
`;
  } else {
    prompt += `
PASO 2 - En esta ocasión NO tienes acceso a internet: usa solo lo que se ve en la foto y el contexto del vendedor.
- productoIdentificado: el nombre más exacto que puedas leer en la foto.
- confianza: "baja".
- datosWeb: lista vacía.
`;
  }

  prompt += REGLAS_REDACCION;
  prompt += `
- marca, edadRecomendada, capacidad y edicion: null si no aplican o no se confirmaron (por la foto, el contexto del vendedor${conBusqueda ? ' o una fuente con confianza alta/media' : ''}).

Tu respuesta debe ser ÚNICAMENTE el objeto JSON del esquema, sin texto antes ni después.`;

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
    if (NIVEL_PENSAMIENTO) {
      cuerpo.generationConfig.thinkingConfig = { thinkingLevel: NIVEL_PENSAMIENTO };
    }
  }

  const modelo = conBusqueda ? MODELO : MODELO_RESPALDO;
  const respuesta = await fetch(urlModelo(modelo), {
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
