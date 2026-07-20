import 'dotenv/config';
import fs from 'fs';
import path from 'path';
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

const ESQUEMA_RESPUESTA = {
  type: SchemaType.OBJECT,
  properties: {
    titulo: { type: SchemaType.STRING },
    marca: { type: SchemaType.STRING, nullable: true },
    descripcion: { type: SchemaType.STRING },
    palabrasClave: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    edadRecomendada: { type: SchemaType.STRING, nullable: true },
    capacidad: { type: SchemaType.STRING, nullable: true },
    edicion: { type: SchemaType.STRING, nullable: true },
  },
  required: ['titulo', 'descripcion', 'palabrasClave'],
};

const PROMPT_ANALISIS = `Analiza esta foto de un producto de venta y completa los campos del esquema.

Reglas importantes:
- descripcion: basala unicamente en lo que se ve o lee con certeza; si no estas seguro de un material o detalle especifico, no lo menciones.
- palabrasClave: usa 5 a 8 terminos ESPECIFICOS que un cliente usaria para buscar este producto exacto (marca, modelo, color, personaje, coleccion, caracteristica distintiva). NO incluyas palabras genericas de categoria como "juguete", "producto", "articulo", "accesorio".
- Los campos marca, edadRecomendada, capacidad y edicion deben ser null si no aplican o no son visibles.`;

function generarSlug(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function sufijoUnico(assetId) {
  return assetId.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
}

async function redimensionarParaAnalisis(buffer) {
  return sharp(buffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function comprimirParaSubida(buffer) {
  return sharp(buffer)
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function main() {
  const [, , rutaFoto, categoriaTitulo, precioTexto] = process.argv;

  if (!rutaFoto || !categoriaTitulo || !precioTexto) {
    console.error('Uso: node scripts/cargar-producto.mjs <ruta-foto> "<Nombre Categoria>" <precio>');
    process.exit(1);
  }

  const precio = Number(precioTexto);
  if (Number.isNaN(precio)) {
    console.error('El precio debe ser un numero. Ejemplo: 850');
    process.exit(1);
  }

  console.log('1. Preparando la foto...');
  const imageBufferOriginal = fs.readFileSync(rutaFoto);
  const imageBufferAnalisis = await redimensionarParaAnalisis(imageBufferOriginal);
  const imageBufferSubida = await comprimirParaSubida(imageBufferOriginal);

  const pesoOriginalKB = Math.round(imageBufferOriginal.length / 1024);
  const pesoSubidaKB = Math.round(imageBufferSubida.length / 1024);
  console.log(`   Peso original: ${pesoOriginalKB} KB -> Peso comprimido: ${pesoSubidaKB} KB`);

  console.log('2. Analizando foto con Gemini...');
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-lite-latest',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: ESQUEMA_RESPUESTA,
    },
  });

  const imagePart = {
    inlineData: {
      data: imageBufferAnalisis.toString('base64'),
      mimeType: 'image/jpeg',
    },
  };

  const result = await model.generateContent([PROMPT_ANALISIS, imagePart]);
  const datos = JSON.parse(result.response.text());

  console.log('Datos extraidos:', datos);

  console.log('3. Buscando la categoria en Sanity...');
  const categoria = await client.fetch(
    `*[_type == "categoria" && titulo == $titulo][0]{_id}`,
    { titulo: categoriaTitulo }
  );

  if (!categoria) {
    console.error(`No se encontro una categoria publicada con el titulo "${categoriaTitulo}". Verifica el nombre exacto en Sanity Studio.`);
    process.exit(1);
  }

  console.log('4. Subiendo la imagen comprimida a Sanity...');
  const asset = await client.assets.upload('image', imageBufferSubida, {
    filename: path.basename(rutaFoto),
  });

  console.log('5. Creando el producto...');
  const slugFinal = `${generarSlug(datos.titulo)}-${sufijoUnico(asset._id)}`;

  const documento = {
    _type: 'producto',
    titulo: datos.titulo,
    slug: { _type: 'slug', current: slugFinal },
    precio,
    estado: 'Nuevo',
    descripcion: datos.descripcion,
    imagenPrincipal: {
      _type: 'image',
      asset: { _type: 'reference', _ref: asset._id },
    },
    categoria: { _type: 'reference', _ref: categoria._id },
    palabrasClave: datos.palabrasClave || [],
    ...(datos.marca ? { marca: datos.marca } : {}),
    ...(datos.capacidad ? { capacidad: datos.capacidad } : {}),
    ...(datos.edicion ? { edicion: datos.edicion } : {}),
    ...(datos.edadRecomendada ? { edadRecomendada: datos.edadRecomendada } : {}),
  };

  const creado = await client.create(documento);
  console.log('Producto creado y publicado con exito.');
  console.log('ID:', creado._id);
  console.log('Titulo:', creado.titulo);
  console.log('Slug:', slugFinal);
}

main().catch((error) => {
  console.error('Ocurrio un error:', error.message);
  process.exit(1);
});
