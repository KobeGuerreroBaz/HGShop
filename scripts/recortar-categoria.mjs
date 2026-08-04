import 'dotenv/config';
import sharp from 'sharp';
import { createClient } from '@sanity/client';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const ESQUEMA_RECORTE = {
  type: SchemaType.OBJECT,
  properties: {
    boundingBox: {
      type: SchemaType.OBJECT,
      properties: {
        ymin: { type: SchemaType.NUMBER },
        xmin: { type: SchemaType.NUMBER },
        ymax: { type: SchemaType.NUMBER },
        xmax: { type: SchemaType.NUMBER },
      },
      required: ['ymin', 'xmin', 'ymax', 'xmax'],
    },
  },
  required: ['boundingBox'],
};

const PROMPT_RECORTE = `Detecta el producto principal en esta foto (incluyendo su empaque o blister card si lo tiene) y da las coordenadas del rectangulo que lo contiene por completo.

Usa un sistema de coordenadas normalizado de 0 a 1000, donde (0,0) es la esquina superior izquierda de la imagen y (1000,1000) es la esquina inferior derecha.`;

const PORCENTAJE_MARGEN = 0.20;
const MAX_REINTENTOS = 5;
const PAUSA_ENTRE_PRODUCTOS_MS = 1500;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esErrorDeSaturacion(error) {
  const mensaje = (error?.message || '').toLowerCase();
  return (
    mensaje.includes('429') ||
    mensaje.includes('rate limit') ||
    mensaje.includes('quota') ||
    mensaje.includes('overloaded') ||
    mensaje.includes('503') ||
    mensaje.includes('unavailable') ||
    mensaje.includes('high demand')
  );
}

function construirUrlAsset(assetRef, projectId) {
  const partes = assetRef.replace('image-', '').split('-');
  const formato = partes.pop();
  const dimensiones = partes.pop();
  const id = partes.join('-');
  return `https://cdn.sanity.io/images/${projectId}/production/${id}-${dimensiones}.${formato}`;
}

async function detectarRecorteConReintentos(buffer) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-lite-latest',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: ESQUEMA_RECORTE,
    },
  });

  const imagePart = {
    inlineData: {
      data: buffer.toString('base64'),
      mimeType: 'image/jpeg',
    },
  };

  let ultimoError;

  for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
    try {
      const result = await model.generateContent([PROMPT_RECORTE, imagePart]);
      const datos = JSON.parse(result.response.text());
      return datos.boundingBox;
    } catch (error) {
      ultimoError = error;

      if (!esErrorDeSaturacion(error) || intento === MAX_REINTENTOS) {
        throw error;
      }

      const esperaMs = 3000 * intento;
      console.log(`  (Gemini saturado, reintentando en ${esperaMs / 1000}s... intento ${intento}/${MAX_REINTENTOS})`);
      await esperar(esperaMs);
    }
  }

  throw ultimoError;
}

function calcularRectanguloConMargen(boundingBox, anchoReal, altoReal) {
  const { ymin, xmin, ymax, xmax } = boundingBox;

  const anchoBox = xmax - xmin;
  const altoBox = ymax - ymin;
  const margenX = anchoBox * PORCENTAJE_MARGEN;
  const margenY = altoBox * PORCENTAJE_MARGEN;

  const xminConMargen = Math.max(0, xmin - margenX);
  const yminConMargen = Math.max(0, ymin - margenY);
  const xmaxConMargen = Math.min(1000, xmax + margenX);
  const ymaxConMargen = Math.min(1000, ymax + margenY);

  const escalaX = anchoReal / 1000;
  const escalaY = altoReal / 1000;

  const left = Math.round(xminConMargen * escalaX);
  const top = Math.round(yminConMargen * escalaY);
  const width = Math.round((xmaxConMargen - xminConMargen) * escalaX);
  const height = Math.round((ymaxConMargen - yminConMargen) * escalaY);

  return { left, top, width, height };
}

async function procesarProducto(producto, projectId) {
  const assetRef = producto.imagenPrincipal?.asset?._ref;
  if (!assetRef) {
    console.log(`  Sin imagen principal, se omite.`);
    return { ok: false, omitido: true };
  }

  const url = construirUrlAsset(assetRef, projectId);
  const respuesta = await fetch(url);
  const bufferOriginal = Buffer.from(await respuesta.arrayBuffer());

  const metadata = await sharp(bufferOriginal).metadata();
  const anchoReal = metadata.width;
  const altoReal = metadata.height;

  console.log(`  Detectando producto en la foto (${anchoReal}x${altoReal})...`);
  const boundingBox = await detectarRecorteConReintentos(bufferOriginal);

  const rectangulo = calcularRectanguloConMargen(boundingBox, anchoReal, altoReal);
  console.log(`  Recortando: left=${rectangulo.left} top=${rectangulo.top} width=${rectangulo.width} height=${rectangulo.height}`);

  const bufferRecortado = await sharp(bufferOriginal)
    .extract(rectangulo)
    .jpeg({ quality: 85 })
    .toBuffer();

  console.log('  Subiendo imagen recortada...');
  const nuevoAsset = await client.assets.upload('image', bufferRecortado, {
    filename: `recortado-${producto._id}.jpg`,
  });

  await client
    .patch(producto._id)
    .set({ 'imagenPrincipal.asset._ref': nuevoAsset._id })
    .commit();

  console.log(`  Listo: "${producto.titulo}"`);
  return { ok: true };
}

async function main() {
  const [, , categoriaTitulo, limiteTexto] = process.argv;

  if (!categoriaTitulo) {
    console.error('Uso: node scripts/recortar-categoria.mjs "<Nombre Categoria>" [limite]');
    process.exit(1);
  }

  const limite = limiteTexto ? Number(limiteTexto) : Infinity;
  if (limiteTexto && Number.isNaN(limite)) {
    console.error('El limite debe ser un numero.');
    process.exit(1);
  }

  console.log('Buscando la categoria en Sanity...');
  const categoria = await client.fetch(
    `*[_type == "categoria" && titulo == $titulo][0]{_id}`,
    { titulo: categoriaTitulo }
  );

  if (!categoria) {
    console.error(`No se encontro una categoria con el titulo "${categoriaTitulo}".`);
    process.exit(1);
  }

  const productos = await client.fetch(
    `*[_type == "producto" && categoria._ref == $categoriaId]{
      _id,
      titulo,
      imagenPrincipal,
      "yaRecortado": imagenPrincipal.asset->originalFilename match "recortado-*"
    }`,
    { categoriaId: categoria._id }
  );

  const pendientes = productos.filter((p) => !p.yaRecortado);
  const yaHechos = productos.length - pendientes.length;

  const aProcesar = pendientes.slice(0, limite);

  console.log(`\nEncontrados ${productos.length} producto(s) en "${categoriaTitulo}".`);
  if (yaHechos > 0) {
    console.log(`${yaHechos} ya estaban recortados previamente, se omiten automaticamente.`);
  }
  console.log(`Procesando ${aProcesar.length} pendiente(s).\n`);

  let exitosos = 0;
  let fallidos = 0;
  let omitidos = 0;
  const fallosDetalle = [];

  for (const producto of aProcesar) {
    console.log(`\n--- ${producto.titulo} ---`);
    try {
      const resultado = await procesarProducto(producto, process.env.SANITY_PROJECT_ID);
      if (resultado.ok) exitosos++;
      if (resultado.omitido) omitidos++;
    } catch (error) {
      console.error(`  Error: ${error.message}`);
      fallidos++;
      fallosDetalle.push(producto.titulo);
    }

    await esperar(PAUSA_ENTRE_PRODUCTOS_MS);
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Recortados con exito: ${exitosos}`);
  console.log(`Fallidos: ${fallidos}`);
  console.log(`Omitidos (sin imagen): ${omitidos}`);
  if (fallosDetalle.length > 0) {
    console.log(`Productos que fallaron: ${fallosDetalle.join(', ')}`);
  }
}

main().catch((error) => {
  console.error('Ocurrio un error:', error.message);
  process.exit(1);
});
