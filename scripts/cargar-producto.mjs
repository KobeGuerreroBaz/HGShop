import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@sanity/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function generarSlug(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
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

  console.log('1. Analizando foto con Gemini...');
  const imageBuffer = fs.readFileSync(rutaFoto);
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

  const prompt = `Analiza esta foto de un producto de venta y devuelve SOLO un JSON valido (sin texto adicional, sin backticks de markdown) con exactamente estos campos:
{
  "titulo": "nombre completo y claro del producto",
  "marca": "marca visible, o null si no aplica",
  "descripcion": "descripcion corta de 1-2 lineas basada en lo que se ve o lee en el empaque",
  "palabrasClave": ["lista", "de", "palabras", "clave", "para", "busqueda"],
  "edadRecomendada": "edad recomendada si aparece en el empaque, o null",
  "capacidad": "capacidad si aplica, ej 260ml o 24oz, o null",
  "edicion": "edicion especial si se menciona, o null"
}`;

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType: 'image/jpeg',
    },
  };

  const result = await model.generateContent([prompt, imagePart]);
  const textoRespuesta = result.response.text();
  const jsonLimpio = textoRespuesta.replace(/```json|```/g, '').trim();
  const datos = JSON.parse(jsonLimpio);

  console.log('Datos extraidos:', datos);

  console.log('2. Buscando la categoria en Sanity...');
  const categoria = await client.fetch(
    `*[_type == "categoria" && titulo == $titulo][0]{_id}`,
    { titulo: categoriaTitulo }
  );

  if (!categoria) {
    console.error(`No se encontro una categoria publicada con el titulo "${categoriaTitulo}". Verifica el nombre exacto en Sanity Studio.`);
    process.exit(1);
  }

  console.log('3. Subiendo la imagen a Sanity...');
  const asset = await client.assets.upload('image', imageBuffer, {
    filename: path.basename(rutaFoto),
  });

  console.log('4. Creando el producto...');
  const documento = {
    _type: 'producto',
    titulo: datos.titulo,
    slug: { _type: 'slug', current: generarSlug(datos.titulo) },
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
}

main().catch((error) => {
  console.error('Ocurrio un error:', error.message);
  process.exit(1);
});
