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

import { esFlujoValido, limpiarReferenciaPrecio } from './flujos-precio.mjs';

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
    tipoPrecio: { type: 'string', enum: ['autos-escala', 'juguete', 'pokemon', 'otro'] },
    alertaValor: TEXTO_NULO,
  },
  required: [
    'titulo',
    'descripcion',
    'altTexto',
    'palabrasClave',
    'productoIdentificado',
    'confianza',
    'datosWeb',
    'tipoPrecio',
  ],
};

const REGLAS_TIPO = `
Clasificación (no se muestra al cliente):
- tipoPrecio: "autos-escala" si es un vehículo a escala o diecast (Hot Wheels, Matchbox, M2, Greenlight, Majorette, Cars de Mattel, etc.); "pokemon" si es producto de Pokémon TCG (cartas, sobres, cajas, latas); "juguete" si es cualquier otro juguete (muñecas, figuras, LEGO, peluches, juegos de mesa, vehículos de juguete que no son a escala); "otro" para todo lo demás (cremas, perfumes, termos, ropa, artículos de bebé, mochilas, herramientas).
- alertaValor: SOLO para "autos-escala" y "pokemon". Si en la foto ves señales de que la pieza puede valer bastante más de lo normal, descríbelas en una frase (ej. "Posible Super Treasure Hunt: pintura Spectraflame y llantas Real Riders", "Treasure Hunt: logo de flama en la tarjeta", "Línea premium Car Culture", "Carta con ilustración especial"). null si no hay señales o para cualquier otro tipo.`;

const REGLAS_REDACCION = `
Reglas de redacción:
- Responde SIEMPRE en español, sin importar el idioma de la foto, del empaque o de las fuentes.
- Escribe con ortografía correcta en español: acentos (á, é, í, ó, ú), ñ, ü y signos de apertura (¿ ¡). Ejemplos: "colección", "diseño", "acción", "metálicos", "automóviles", "superhéroes", "niños". Nunca omitas un acento ni cambies la ñ por n. Esto aplica a titulo, descripcion, altTexto y palabrasClave.
- Redacta todo con tus propias palabras. Nunca copies ni parafrasees de cerca frases de Amazon, del fabricante u otra tienda; usa sus datos, no su texto.
- descripcion: escribe en tono de venta, resaltando lo atractivo del producto (calidad, diseño, uso, para quién es ideal) sin exagerar ni inventar cualidades que no se ven o no fueron confirmadas. Nada de frases genéricas vacías tipo "producto de excelente calidad"; sé específico sobre qué lo hace atractivo.
- La descripción también debe ayudar a que la página aparezca en buscadores como Google: menciona el tipo de producto, la marca y la característica principal en la primera oración, usando el lenguaje natural con el que un comprador buscaría este producto (ej. "portagel antibacterial", "wallflower aromatizante", "hot wheels edición limitada"). No repitas la misma palabra clave de forma forzada ni antinatural; escribe primero para un humano.
- altTexto: escribe una descripción breve (máximo 125 caracteres) de LO QUE SE VE EN LA FOTO específicamente; no repitas el título tal cual. Menciona color, forma o detalle visible distintivo (ej. "Termo Stanley FlowState azul marino con tapa abatible" en vez de solo "Termo Stanley"). Es para el atributo alt de la imagen, pensado para accesibilidad y buscadores de imágenes, no para venta.
- palabrasClave: usa 5 a 8 términos ESPECÍFICOS que un cliente usaría para buscar este producto exacto (marca, modelo, color, personaje, colección, característica distintiva). Incluye el código o número de modelo si lo confirmaste. Incluye también 1 o 2 formas en que la gente en México le dice a este producto si son distintas al título (ej. "mamila" para biberón, "carrito" para Hot Wheels, "termo" para vaso térmico, "lonchera" para lunch box). NO incluyas palabras genéricas de categoría como "juguete", "producto", "artículo", "accesorio".`;

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

${REGLAS_TIPO}

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

// IMPORTANTE (comprobado el 22 oct 2026): con la búsqueda de Google activa NO se usa
// responseJsonSchema. Con el esquema, Gemini deja de buscar (0 búsquedas, 0 fuentes) y
// contesta de memoria. Por eso, en las llamadas con búsqueda se pide el JSON en el prompt
// y se deja solo responseMimeType; el código ya valida y tolera la respuesta.
const textoEsquema = (esquema) =>
  `\n\nFORMATO DE RESPUESTA: devuelve ÚNICAMENTE un objeto JSON válido (sin texto antes ni después, sin bloque de código) que cumpla este esquema JSON:\n${JSON.stringify(esquema)}`;

class BusquedaNoRealizada extends Error {}

/** true si Google realmente buscó (hay consultas de búsqueda o fuentes). */
const huboBusqueda = (candidato, fuentes) =>
  (candidato?.groundingMetadata?.webSearchQueries?.length || 0) > 0 || fuentes.length > 0;

async function llamarGemini({ apiKey, imagenBase64, mimeType, contexto, conBusqueda }) {
  const cuerpo = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: construirPrompt(contexto, conBusqueda) + (conBusqueda ? textoEsquema(ESQUEMA_RESPUESTA) : '') },
          { inline_data: { mime_type: mimeType, data: imagenBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(conBusqueda ? {} : { responseJsonSchema: ESQUEMA_RESPUESTA }),
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

  const fuentes = conBusqueda ? extraerFuentes(candidato) : [];
  // Si pidió búsqueda y Gemini no buscó, el resultado vino de memoria: se descarta y
  // analizarProducto cae al plan B (solo foto, confianza baja) en vez de fingir verificación.
  if (conBusqueda && !huboBusqueda(candidato, fuentes)) {
    throw new BusquedaNoRealizada('Gemini no hizo la busqueda en internet');
  }
  return { datos, fuentes };
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
    tipoPrecio: esFlujoValido(datos.tipoPrecio) ? datos.tipoPrecio : 'otro',
    alertaValor:
      esFlujoValido(datos.tipoPrecio) && datos.tipoPrecio !== 'juguete' && typeof datos.alertaValor === 'string' && datos.alertaValor.trim()
        ? datos.alertaValor.trim()
        : null,
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


// ===========================================================================
// REFERENCIA DE PRECIO (segunda llamada, solo autos a escala, juguetes y Pokémon)
// ===========================================================================
// Busca precios ACTUALES con reglas de fuentes distintas por tipo de producto.
// Nunca decide el precio: devuelve lo encontrado con tienda, moneda y link.

const REGLAS_FUENTES = {
  'autos-escala': `Fuentes PERMITIDAS:
- Precio de tienda en EE.UU. de la marca o tiendas grandes (walmart.com, target.com, creations.mattel.com, sitio oficial de la marca) → tipo "tienda", en USD.
- eBay: SOLO ventas completadas/vendidas (sold listings), nunca anuncios activos → tipo "vendido", en USD. Da un rango típico o 1 a 3 ventas representativas.
- Wikis y bases de coleccionistas (hotwheels.fandom.com, hobbyDB) SOLO para confirmar si es Treasure Hunt, Super Treasure Hunt, premium, RLC o edición limitada; no son fuente de precio.
PROHIBIDO: MercadoLibre, Amazon y cualquier anuncio de revendedor (las comisiones y envíos inflan el precio).
alertaValor: si confirmas que es Treasure Hunt, Super Treasure Hunt, premium, RLC, limitada o un modelo muy buscado, dilo con el motivo; null si es un mainline común.`,

  juguete: `Fuentes PERMITIDAS: SOLO venta directa de tiendas, nunca revendedores.
- México (MXN): Walmart México, Liverpool, Coppel, Sanborns, El Palacio de Hierro, Juguetrón, Soriana, Amazon México SOLO cuando el vendedor es Amazon, tienda oficial de la marca en MercadoLibre (Tienda oficial).
- Si el producto no existe en México: tiendas de EE.UU. (walmart.com, target.com, amazon.com cuando vende Amazon) en USD.
Todos con tipo "tienda". PROHIBIDO: vendedores particulares o revendedores en MercadoLibre, Amazon u otros.
alertaValor: null.`,

  pokemon: `Fuentes PERMITIDAS:
- TCGplayer (precio de mercado / market price) → tipo "precio-mercado", en USD.
- eBay SOLO ventas completadas/vendidas → tipo "vendido", en USD.
- Collectr si aparece → tipo "precio-mercado".
- Pokémon Center → tipo "tienda".
- MercadoLibre y Amazon, incluida reventa → tipo "tienda" si vende la marca o Amazon, "reventa" si es otro vendedor.
Distingue carta suelta vs. producto sellado (sobre, caja, lata). En cartas, cuida la versión exacta: número de carta, set, holo/reverse holo, idioma y estado si se ve.
alertaValor: si es carta valiosa (ilustración especial, secreta, full art, primera edición) o producto sellado descontinuado, dilo con el motivo; null si no.`,
};

const ESQUEMA_PRECIO = {
  type: 'object',
  properties: {
    productoBuscado: { type: 'string' },
    alertaValor: TEXTO_NULO,
    precios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tienda: { type: 'string' },
          dominio: { type: 'string' },
          tipo: { type: 'string', enum: ['tienda', 'vendido', 'precio-mercado', 'reventa'] },
          precio: { type: 'number' },
          moneda: { type: 'string', enum: ['MXN', 'USD'] },
          detalle: TEXTO_NULO,
        },
        required: ['tienda', 'dominio', 'tipo', 'precio', 'moneda'],
      },
    },
    nota: TEXTO_NULO,
  },
  required: ['productoBuscado', 'precios'],
};

function construirPromptPrecio(flujo, producto) {
  const datos = [
    `Producto: ${producto.productoIdentificado || producto.titulo}`,
    producto.titulo && producto.titulo !== producto.productoIdentificado ? `Título en el catálogo: ${producto.titulo}` : '',
    producto.marca ? `Marca: ${producto.marca}` : '',
    producto.edicion ? `Edición/serie: ${producto.edicion}` : '',
    Array.isArray(producto.palabrasClave) && producto.palabrasClave.length ? `Palabras clave: ${producto.palabrasClave.join(', ')}` : '',
    producto.alertaValor ? `Señal vista en la foto: ${producto.alertaValor}` : '',
  ].filter(Boolean).join('\n');

  return `Eres asistente de una tienda de reventa en Monterrey, México. Busca en Google precios ACTUALES de ESTE producto exacto para que el dueño decida su precio de venta.

${datos}

${REGLAS_FUENTES[flujo]}

Reglas generales:
- Solo incluye precios que viste en una fuente durante la búsqueda. Nunca inventes ni estimes un precio.
- Debe ser el mismo producto y la misma variante (modelo, color, tamaño, edición). Si no estás seguro de que sea el mismo, no lo incluyas.
- Escribe el precio tal como aparece, en su moneda (MXN o USD); no conviertas.
- tienda: nombre corto de la tienda (ej. "Walmart EE.UU.", "Liverpool", "eBay (vendido)", "TCGplayer"). dominio: el dominio de la fuente (ej. "walmart.com", "liverpool.com.mx").
- detalle: dato corto útil si aplica (ej. "promedio de 5 ventas", "sobre sellado", "carta suelta NM", "precio con descuento").
- Máximo 8 precios, los más relevantes primero. Si no encuentras nada confiable, lista vacía y explica por qué en "nota".
- productoBuscado: el nombre exacto de lo que buscaste.
- Todo en español.

Tu respuesta debe ser ÚNICAMENTE el objeto JSON del esquema.`;
}

/** Une cada precio con el link real que devolvió Google (por dominio). */
function asignarLinks(precios, fuentes) {
  return precios.map((p) => {
    const dominio = String(p.dominio || '').toLowerCase().replace(/^www\./, '');
    const fuente = dominio
      ? fuentes.find((f) => {
          const t = String(f.titulo || '').toLowerCase().replace(/^www\./, '');
          return t && (t.includes(dominio) || dominio.includes(t));
        })
      : null;
    return { ...p, url: fuente ? fuente.url : null };
  });
}

let cacheTipoCambio = null; // { fecha, valor }

/**
 * Pesos por dólar del día (fuente pública Frankfurter, sin llave). null si no responde:
 * en ese caso los precios en dólares se muestran sin conversión.
 */
export async function obtenerTipoCambioUsdMxn() {
  const hoy = new Date().toISOString().slice(0, 10);
  if (cacheTipoCambio && cacheTipoCambio.fecha === hoy) return cacheTipoCambio.valor;
  const intentos = [
    ['https://api.frankfurter.dev/v2/rate/USD/MXN', (j) => j?.rate],
    ['https://api.frankfurter.dev/v1/latest?base=USD&symbols=MXN', (j) => j?.rates?.MXN],
  ];
  for (const [url, leer] of intentos) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const valor = Number(leer(await r.json()));
      if (Number.isFinite(valor) && valor > 5 && valor < 100) {
        cacheTipoCambio = { fecha: hoy, valor: Math.round(valor * 100) / 100 };
        return cacheTipoCambio.valor;
      }
    } catch {
      // probar la siguiente
    }
  }
  return null;
}

/**
 * Busca la referencia de precio de un producto ya identificado.
 * @param {object} opciones
 * @param {string} opciones.apiKey
 * @param {'autos-escala'|'juguete'|'pokemon'} opciones.flujo
 * @param {{titulo:string, productoIdentificado?:string, marca?:string, edicion?:string, palabrasClave?:string[], alertaValor?:string}} opciones.producto
 * @returns {Promise<object>} referencia limpia (ver limpiarReferenciaPrecio) lista para mostrar y guardar.
 */
export async function buscarReferenciaPrecio({ apiKey, flujo, producto }) {
  // Si Gemini no busca en internet, un precio sería inventado: se reintenta una vez y, si
  // sigue sin buscar, se devuelve la referencia vacía y avisando, nunca precios sin verificar.
  try {
    return await buscarReferenciaPrecioUnaVez({ apiKey, flujo, producto });
  } catch (error) {
    if (!(error instanceof BusquedaNoRealizada)) throw error;
  }
  try {
    return await buscarReferenciaPrecioUnaVez({ apiKey, flujo, producto });
  } catch (error) {
    if (!(error instanceof BusquedaNoRealizada)) throw error;
    return limpiarReferenciaPrecio({
      fecha: new Date().toISOString().slice(0, 10),
      flujo,
      productoBuscado: producto.productoIdentificado || producto.titulo,
      alertaValor: null,
      tipoCambio: null,
      nota: 'La búsqueda en internet no se realizó; no se muestran precios sin verificar. Vuelve a intentar.',
      precios: [],
      fuentes: [],
    });
  }
}

async function buscarReferenciaPrecioUnaVez({ apiKey, flujo, producto }) {
  if (!apiKey) throw new Error('Falta GEMINI_API_KEY');
  if (!esFlujoValido(flujo)) throw new Error('Este tipo de producto no usa búsqueda de precio');
  if (!producto?.titulo && !producto?.productoIdentificado) throw new Error('Falta el nombre del producto');

  const cuerpo = {
    contents: [{ role: 'user', parts: [{ text: construirPromptPrecio(flujo, producto) + textoEsquema(ESQUEMA_PRECIO) }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(NIVEL_PENSAMIENTO ? { thinkingConfig: { thinkingLevel: NIVEL_PENSAMIENTO } } : {}),
    },
  };

  const [respuesta, tipoCambio] = await Promise.all([
    fetch(urlModelo(MODELO), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_CON_BUSQUEDA_MS + 15000),
    }),
    obtenerTipoCambioUsdMxn(),
  ]);

  const json = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new Error(`Gemini respondio con error: ${json?.error?.message || `HTTP ${respuesta.status}`}`);
  }
  const candidato = json?.candidates?.[0];
  const datos = parsearJson(extraerTexto(candidato));
  if (!datos || !Array.isArray(datos.precios)) {
    throw new Error('Gemini devolvio una respuesta incompleta; intenta de nuevo');
  }

  const fuentes = extraerFuentes(candidato);
  if (!huboBusqueda(candidato, fuentes)) throw new BusquedaNoRealizada('Gemini no hizo la busqueda en internet');
  const precios = asignarLinks(datos.precios, fuentes).map((p) => ({
    ...p,
    mxn: p.moneda === 'USD' && tipoCambio ? Math.round(Number(p.precio) * tipoCambio) : null,
  }));

  return limpiarReferenciaPrecio({
    fecha: new Date().toISOString().slice(0, 10),
    flujo,
    productoBuscado: datos.productoBuscado,
    alertaValor: flujo === 'juguete' ? null : datos.alertaValor || producto.alertaValor || null,
    tipoCambio,
    nota: datos.nota,
    precios,
    fuentes,
  });
}
