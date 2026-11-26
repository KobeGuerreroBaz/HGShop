import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { createClient } from '@sanity/client';
import { analizarProducto } from '../src/lib/gemini-producto.mjs';

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

function mostrarIdentificacion(datos) {
  if (datos.avisoBusqueda) console.log(`   Aviso: ${datos.avisoBusqueda}`);
  console.log(`   Identificado como: ${datos.productoIdentificado}`);
  console.log(`   Confianza: ${datos.confianza.toUpperCase()}${datos.busquedaUsada ? '' : ' (sin busqueda web)'}`);
  if (datos.confianza === 'baja') console.log('   !! Confianza baja: revisa titulo y descripcion antes de publicar.');
  if (datos.datosWeb.length > 0) console.log(`   Datos tomados de internet: ${datos.datosWeb.join(' | ')}`);
  for (const fuente of datos.fuentes) console.log(`   Fuente: ${fuente.titulo} -> ${fuente.url}`);
}

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
  const [, , rutaFoto, categoriaTitulo, precioTexto, contextoTexto] = process.argv;

  if (!rutaFoto || !categoriaTitulo || !precioTexto) {
    console.error('Uso: node scripts/cargar-producto.mjs <ruta-foto> "<Nombre Categoria>" <precio> ["contexto opcional"]');
    process.exit(1);
  }

  const precio = Number(precioTexto);
  if (Number.isNaN(precio)) {
    console.error('El precio debe ser un numero. Ejemplo: 850');
    process.exit(1);
  }

  const contexto = contextoTexto && contextoTexto.trim() !== '' ? contextoTexto.trim() : null;

  console.log('1. Preparando la foto...');
  const imageBufferOriginal = fs.readFileSync(rutaFoto);
  const imageBufferAnalisis = await redimensionarParaAnalisis(imageBufferOriginal);
  const imageBufferSubida = await comprimirParaSubida(imageBufferOriginal);

  const pesoOriginalKB = Math.round(imageBufferOriginal.length / 1024);
  const pesoSubidaKB = Math.round(imageBufferSubida.length / 1024);
  console.log(`   Peso original: ${pesoOriginalKB} KB -> Peso comprimido: ${pesoSubidaKB} KB`);

  console.log('2. Analizando foto con Gemini (buscando el producto en internet)...');
  const datos = await analizarProducto({
    apiKey: process.env.GEMINI_API_KEY,
    imagenBase64: imageBufferAnalisis.toString('base64'),
    mimeType: 'image/jpeg',
    contexto,
  });

  mostrarIdentificacion(datos);
  console.log('Datos extraidos:', {
    titulo: datos.titulo,
    marca: datos.marca,
    descripcion: datos.descripcion,
    altTexto: datos.altTexto,
    palabrasClave: datos.palabrasClave,
    edadRecomendada: datos.edadRecomendada,
    capacidad: datos.capacidad,
    edicion: datos.edicion,
  });

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
    ...(datos.altTexto ? { altTexto: datos.altTexto } : {}),
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
