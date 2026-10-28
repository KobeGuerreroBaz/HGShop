// Referencia de precio + demanda para los productos SIN precio (Hot Wheels, Cars, Juguetes...).
//
// Uso (desde la raíz del repo):
//   node scripts/referencia-precios-sin-precio.mjs                 piloto de 15 (solo reporte, NO escribe en Sanity)
//   node scripts/referencia-precios-sin-precio.mjs --limite 30     piloto de otro tamaño
//   node scripts/referencia-precios-sin-precio.mjs --dep cars      solo un departamento
//   node scripts/referencia-precios-sin-precio.mjs --todos         todos los productos sin precio
//   node scripts/referencia-precios-sin-precio.mjs --guardar       además guarda referenciaPrecio en Sanity
//   node scripts/referencia-precios-sin-precio.mjs --forzar        también los que ya tienen referencia
//
// NUNCA cambia el precio, la cantidad ni nada más: con --guardar solo escribe el campo
// interno referenciaPrecio. La demanda (¿es un casting buscado?) queda solo en el reporte.
// El reporte se guarda en scripts/salida/ (no se sube a GitHub).

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@sanity/client';
import { buscarReferenciaPrecio } from '../src/lib/gemini-producto.mjs';
import { FLUJO_POR_DEPARTAMENTO, flujoParaDepartamento } from '../src/lib/flujos-precio.mjs';

const MODELO = 'gemini-3.5-flash-lite';
const URL_MODELO = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;
const SIMULTANEOS = 3;
const COSTO_APROX_POR_LLAMADA_USD = 0.003;

// ---------- argumentos ----------
const args = process.argv.slice(2);
const tiene = (b) => args.includes(b);
const valor = (b) => {
  const i = args.indexOf(b);
  return i >= 0 ? args[i + 1] : undefined;
};
const GUARDAR = tiene('--guardar');
const FORZAR = tiene('--forzar');
const TODOS = tiene('--todos');
const DEP = valor('--dep');
const LIMITE = TODOS ? Infinity : Math.max(1, parseInt(valor('--limite') || '15', 10) || 15);

for (const nombre of ['SANITY_PROJECT_ID', 'SANITY_API_TOKEN', 'GEMINI_API_KEY']) {
  if (!process.env[nombre]) {
    console.error(`Falta ${nombre} en .env`);
    process.exit(1);
  }
}
if (DEP && !FLUJO_POR_DEPARTAMENTO[DEP]) {
  console.error(`El departamento "${DEP}" no usa referencia de precio. Opciones: ${Object.keys(FLUJO_POR_DEPARTAMENTO).join(', ')}`);
  process.exit(1);
}

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

// ---------- utilidades ----------
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function conReintento(fn) {
  try {
    return await fn();
  } catch (error) {
    await dormir(2500);
    return await fn();
  }
}

async function enPool(items, n, fn) {
  const salida = new Array(items.length);
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (true) {
        const k = siguiente++;
        if (k >= items.length) break;
        salida[k] = await fn(items[k], k);
      }
    })
  );
  return salida;
}

function parsearJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
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

// ---------- demanda: ¿es un casting buscado? (búsqueda en internet) ----------
const ESQUEMA_DEMANDA = {
  type: 'object',
  properties: {
    productoBuscado: { type: 'string' },
    demanda: { type: 'string', enum: ['alta', 'media', 'baja', 'sin-datos'] },
    motivo: { type: 'string' },
    senales: { type: 'array', items: { type: 'string' } },
  },
  required: ['productoBuscado', 'demanda', 'motivo', 'senales'],
};

const textoEsquema = (esquema) =>
  `\n\nFORMATO DE RESPUESTA: devuelve ÚNICAMENTE un objeto JSON válido (sin texto antes ni después, sin bloque de código) que cumpla este esquema JSON:\n${JSON.stringify(esquema)}`;

function promptDemanda(p) {
  const datos = [
    `Producto: ${p.titulo}`,
    p.marca ? `Marca: ${p.marca}` : '',
    p.edicion ? `Edición/serie: ${p.edicion}` : '',
    Array.isArray(p.palabrasClave) && p.palabrasClave.length ? `Palabras clave: ${p.palabrasClave.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  return `Eres asistente de una tienda de reventa de autos a escala y juguetes en Monterrey, México. Tu tarea: investigar en Google si este producto (y su casting, es decir, el molde del modelo) es BUSCADO por coleccionistas, aunque no sea una pieza rara ni especial. El dueño quiere evitar venderlo barato si tiene demanda.

${datos}

Busca señales reales como:
- Ventas completadas en eBay y a qué precio se vendieron frente a un modelo común de la misma marca.
- Bases de datos y wikis de coleccionistas (hobbyDB, wikis de la marca) que lo describan como popular, buscado, difícil de conseguir o "chase".
- Comentarios en foros y comunidades de coleccionistas sobre qué tan buscado es.
- Si el auto real que representa es muy querido entre aficionados (esto cuenta solo si además hay evidencia de que sus versiones a escala se buscan).

Reglas:
- Basa la calificación solo en lo que viste en la búsqueda. Si no hay evidencia, demanda = "sin-datos". Nunca adivines.
- La popularidad del auto real (por ejemplo "es un Porsche muy querido") NO cuenta por sí sola: necesitas evidencia de que las versiones a escala se buscan o se venden caro.
- demanda "alta": al menos 3 señales concretas, con ventas completadas que se pagan claramente por encima (al menos el doble) de lo que cuesta un modelo común en tienda, o menciones de que es "chase", "grail", agotado o muy difícil de conseguir.
- demanda "media": al menos 2 señales concretas, por ejemplo ventas completadas por encima del precio de tienda más una mención específica de coleccionistas sobre ese casting.
- demanda "baja": hay datos y muestran que es un modelo común que se vende a precio normal o barato.
- demanda "sin-datos": no hay evidencia suficiente. Prefiere "baja" o "sin-datos" antes que "media" cuando dudes.
- Los precios de listados de reventa activos (MercadoLibre, Amazon) NO son evidencia de demanda.
- motivo: una o dos frases en español que expliquen la calificación.
- senales: lista corta (máximo 5) de las evidencias concretas que viste, cada una en una línea corta (ej. "ventas en eBay entre US$8 y US$15", "hobbyDB lo marca como muy buscado").
- productoBuscado: el nombre exacto de lo que buscaste.
- Todo en español.

Tu respuesta debe ser ÚNICAMENTE el objeto JSON del esquema.`;
}

async function buscarDemanda(producto) {
  const cuerpo = {
    // Sin responseJsonSchema a propósito: con el esquema Gemini deja de buscar en internet.
    contents: [{ role: 'user', parts: [{ text: promptDemanda(producto) + textoEsquema(ESQUEMA_DEMANDA) }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };
  const respuesta = await fetch(URL_MODELO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(60000),
  });
  const json = await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw new Error(`Gemini (demanda): ${json?.error?.message || `HTTP ${respuesta.status}`}`);

  const candidato = json?.candidates?.[0];
  const texto = (candidato?.content?.parts || [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  const datos = parsearJson(texto);
  if (!datos || typeof datos.motivo !== 'string') throw new Error('Gemini (demanda) devolvió una respuesta incompleta');

  const vistas = new Set();
  const fuentes = [];
  for (const trozo of candidato?.groundingMetadata?.groundingChunks || []) {
    const web = trozo?.web;
    if (!web?.uri || !/^https?:\/\//i.test(web.uri)) continue;
    const titulo = web.title || web.domain || 'fuente';
    if (vistas.has(titulo)) continue;
    vistas.add(titulo);
    fuentes.push({ titulo, url: web.uri });
    if (fuentes.length >= 5) break;
  }

  // Sin búsqueda real la respuesta sería de memoria: se descarta (conReintento lo intenta otra vez).
  const hizoBusqueda = (candidato?.groundingMetadata?.webSearchQueries?.length || 0) > 0 || fuentes.length > 0;
  if (!hizoBusqueda) throw new Error('Gemini no hizo la búsqueda en internet (resultado descartado)');

  return {
    demanda: ['alta', 'media', 'baja', 'sin-datos'].includes(datos.demanda) ? datos.demanda : 'sin-datos',
    motivo: String(datos.motivo).slice(0, 400),
    senales: (Array.isArray(datos.senales) ? datos.senales : []).slice(0, 5).map((s) => String(s).slice(0, 200)),
    fuentes,
  };
}

// ---------- selección de productos ----------
async function traerProductos() {
  const departamentos = DEP ? [DEP] : Object.keys(FLUJO_POR_DEPARTAMENTO);
  const lista = await client.fetch(
    `*[_type == "producto" && !(_id in path("drafts.**")) && !defined(precio) && agotado != true
       && categoria->departamento in $departamentos]
      | order(_createdAt asc) {
        _id, titulo, marca, edicion, palabrasClave, referenciaPrecio,
        "departamento": categoria->departamento
      }`,
    { departamentos }
  );
  return lista.filter((p) => p.titulo && (FORZAR || !p.referenciaPrecio));
}

// Solo para ARMAR EL PILOTO: mete a propósito unos Nissan/JDM y camionetas para comprobar
// que la búsqueda de demanda distingue. No decide nada: la demanda sale de internet.
const CASOS_DE_PRUEBA = /skyline|gt-?r|silvia|datsun|240z|fairlady|nissan|pickup|truck|f-?150|bronco|c10|silverado|land cruiser/i;
const CUOTAS_PILOTO = { 'hot-wheels': 10, cars: 3, juguetes: 2 };

function elegirPiloto(productos, limite) {
  if (productos.length <= limite) return productos;
  const elegidos = [];
  const usados = new Set();
  const agregar = (p) => {
    if (!usados.has(p._id) && elegidos.length < limite) {
      usados.add(p._id);
      elegidos.push(p);
    }
  };
  productos.filter((p) => CASOS_DE_PRUEBA.test(p.titulo)).slice(0, 5).forEach(agregar);
  for (const [dep, cuota] of Object.entries(CUOTAS_PILOTO)) {
    const ya = elegidos.filter((p) => p.departamento === dep).length;
    productos.filter((p) => p.departamento === dep && !usados.has(p._id)).slice(0, Math.max(0, cuota - ya)).forEach(agregar);
  }
  productos.forEach(agregar);
  return elegidos;
}

// ---------- reporte ----------
const dinero = (p) =>
  p.moneda === 'USD' ? `US$${p.precio}${p.mxn ? ` (~$${p.mxn} MXN)` : ''}` : `$${p.precio} MXN`;

// Rareza real (no solo "muy buscado"): lo buscado pero común va al grupo 2.
const RAREZA_REAL = /treasure|\bsth\b|\bth\b|rlc|chase|premium|spectraflame|real riders|edici[oó]n limitada|super treasure|car culture|error|prototipo/i;

function grupoDe(r) {
  if (r.referencia?.alertaValor && RAREZA_REAL.test(r.referencia.alertaValor)) return 1;
  if (r.referencia?.alertaValor || (r.demanda && (r.demanda.demanda === 'alta' || r.demanda.demanda === 'media'))) return 2;
  if (r.referencia && r.referencia.precios.length > 0) return 3;
  return 4;
}

const TITULOS_GRUPO = {
  1: 'Pieza rara o con alerta de valor (revisar primero)',
  2: 'Casting buscado (común, pero con demanda)',
  3: 'Con referencia de precio clara',
  4: 'Sin información útil (mercado de la Y o grupos de Facebook)',
};

function bloqueProducto(r) {
  const l = [];
  l.push(`### ${r.titulo}`);
  l.push(`Departamento: ${r.departamento}`);
  if (r.referencia?.alertaValor) l.push(`**ALERTA:** ${r.referencia.alertaValor}`);
  if (r.demanda) {
    l.push(`**Demanda: ${r.demanda.demanda.toUpperCase()}.** ${r.demanda.motivo}`);
    for (const s of r.demanda.senales) l.push(`- ${s}`);
    for (const f of r.demanda.fuentes) l.push(`- Fuente: [${f.titulo}](${f.url})`);
  } else {
    l.push(`Demanda: no se pudo consultar (${r.errorDemanda || 'error'})`);
  }
  if (r.referencia) {
    if (r.referencia.precios.length === 0) {
      l.push(`Precio ref.: sin precios confiables${r.referencia.nota ? ` (${r.referencia.nota})` : ''}`);
    }
    for (const p of r.referencia.precios) {
      const etiqueta = p.tienda.toLowerCase().includes(p.tipo.toLowerCase()) ? p.tienda : `${p.tienda} (${p.tipo})`;
      l.push(`- Precio ref.: ${etiqueta} ${dinero(p)}${p.detalle ? ` - ${p.detalle}` : ''}${p.url ? ` [link](${p.url})` : ''}`);
    }
  } else {
    l.push(`Precio ref.: no se pudo consultar (${r.errorReferencia || 'error'})`);
  }
  l.push(`ID: ${r._id}`);
  l.push('');
  return l.join('\n');
}

function armarReporte(resultados, meta) {
  const lineas = [];
  lineas.push(`# Referencia de precio y demanda (${meta.modo})`);
  lineas.push(`Fecha: ${meta.fecha} · Productos: ${resultados.length} · Costo aprox.: US$${meta.costo.toFixed(2)}`);
  lineas.push('El precio lo decides tú. Esto es solo referencia.');
  lineas.push('');
  for (const g of [1, 2, 3, 4]) {
    const del = resultados.filter((r) => r.grupo === g);
    lineas.push(`## ${g}. ${TITULOS_GRUPO[g]} (${del.length})`);
    lineas.push('');
    for (const r of del) lineas.push(bloqueProducto(r));
  }
  return lineas.join('\n');
}

// ---------- principal ----------
async function main() {
  console.log(`Modo: ${GUARDAR ? 'GUARDAR en Sanity (solo referenciaPrecio)' : 'PRUEBA (no se escribe nada en Sanity)'}`);
  const todos = await traerProductos();
  console.log(`Productos sin precio con búsqueda disponible: ${todos.length}${FORZAR ? '' : ' (sin contar los que ya tienen referencia)'}`);
  if (todos.length === 0) return;

  const productos = elegirPiloto(todos, LIMITE);
  console.log(`Se procesarán ${productos.length}. Gasto aprox.: US$${(productos.length * 2 * COSTO_APROX_POR_LLAMADA_USD).toFixed(2)}\n`);

  const resultados = await enPool(productos, SIMULTANEOS, async (p, k) => {
    const flujo = flujoParaDepartamento(p.departamento);
    const r = { _id: p._id, titulo: p.titulo, departamento: p.departamento, referencia: null, demanda: null };
    const [ref, dem] = await Promise.allSettled([
      conReintento(() =>
        buscarReferenciaPrecio({
          apiKey: process.env.GEMINI_API_KEY,
          flujo,
          producto: { titulo: p.titulo, marca: p.marca, edicion: p.edicion, palabrasClave: p.palabrasClave },
        })
      ),
      conReintento(() => buscarDemanda(p)),
    ]);
    if (ref.status === 'fulfilled') r.referencia = ref.value;
    else r.errorReferencia = ref.reason?.message;
    if (dem.status === 'fulfilled') r.demanda = dem.value;
    else r.errorDemanda = dem.reason?.message;
    r.grupo = grupoDe(r);
    console.log(`[${k + 1}/${productos.length}] G${r.grupo} · demanda ${r.demanda?.demanda ?? 'error'} · ${p.titulo}`);
    return r;
  });

  if (GUARDAR) {
    let guardados = 0;
    for (const r of resultados) {
      if (!r.referencia) continue;
      await client.patch(r._id).set({ referenciaPrecio: r.referencia }).commit();
      guardados++;
    }
    console.log(`\nGuardadas ${guardados} referencias en Sanity (solo el campo referenciaPrecio).`);
  }

  const ahora = new Date();
  const sello = ahora.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const carpeta = path.join(process.cwd(), 'scripts', 'salida');
  fs.mkdirSync(carpeta, { recursive: true });
  const base = path.join(carpeta, `referencias-${sello}`);
  const meta = {
    modo: GUARDAR ? 'guardado en Sanity' : 'solo reporte',
    fecha: ahora.toISOString().slice(0, 10),
    costo: productos.length * 2 * COSTO_APROX_POR_LLAMADA_USD,
  };
  fs.writeFileSync(`${base}.md`, armarReporte(resultados, meta));
  fs.writeFileSync(`${base}.json`, JSON.stringify(resultados, null, 2));

  const conteo = [1, 2, 3, 4].map((g) => `G${g}: ${resultados.filter((r) => r.grupo === g).length}`).join(' · ');
  console.log(`\nResumen: ${conteo}`);
  console.log(`Reporte: ${base}.md`);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
