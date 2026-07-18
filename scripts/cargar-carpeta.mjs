import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function preguntar(texto) {
  return new Promise((resolve) => rl.question(texto, resolve));
}

function generarSlug(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const EXTENSIONES_VALIDAS = ['.jpg', '.jpeg', '.png', '.webp'];

// Agrupa archivos como "taladro-1.jpg", "taladro-2.jpg" bajo la clave "taladro"
function agruparPorProducto(archivos) {
  const grupos = {};

  for (const archivo of archivos) {
    const ext = path.extname(archivo);
    const nombreSinExt = path.basename(archivo, ext);
    const match = nombreSinExt.match(/^(.+)[-\s](\d+)$/);

    let clave, orden;
    if (match) {
      clave = match[1];
      orden = parseInt(match[2], 10);
    } else {
      clave = nombreSinExt;
      orden = 0;
    }

    if (!grupos[clave]) grupos[clave] = [];
    grupos[clave].push({ archivo, orden });
  }

  // Ordenamos las fotos de cada grupo por su numero
  for (const clave in grupos) {
    grupos[clave].sort((a, b) => a.orden - b.orden);
  }

  return grupos;
}

async function subirImagen(rutaCompleta) {
  const buffer = fs.readFileSync(rutaCompleta);
  const asset = await client.assets.upload('image', buffer, {
    filename: path.basename(rutaCompleta),
  });
  return { buffer, asset };
}

async function procesarProducto(rutaCarpeta, fotosDelGrupo, categoriaId, precio) {
  const primeraFoto = fotosDelGrupo[0].archivo;
  const rutaPrimeraFoto = path.join(rutaCarpeta, primeraFoto);

  console.log(`  1. Analizando foto principal (${primeraFoto}) con Gemini...`);
  const imageBuffer = fs.readFileSync(rutaPrimeraFoto);
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
    inlineData: { data: imageBuffer.toString('base64'), mimeType: 'image/jpeg' },
  };

  const result = await model.generateContent([prompt, imagePart]);
  const textoRespuesta = result.response.text();
  const jsonLimpio = textoRespuesta.replace(/```json|```/g, '').trim();
  const datos = JSON.parse(jsonLimpio);

  console.log(`  Titulo detectado: ${datos.titulo}`);

  console.log(`  2. Subiendo ${fotosDelGrupo.length} foto(s) a Sanity...`);
  const imagenPrincipalAsset = await subirImagen(rutaPrimeraFoto);

  const fotosGaleria = fotosDelGrupo.slice(1);
  const assetsGaleria = [];
  for (const foto of fotosGaleria) {
    const rutaCompleta = path.join(rutaCarpeta, foto.archivo);
    const subida = await subirImagen(rutaCompleta);
    assetsGaleria.push(subida.asset);
  }

  console.log('  3. Creando el producto...');
  const documento = {
    _type: 'producto',
    titulo: datos.titulo,
    slug: { _type: 'slug', current: generarSlug(datos.titulo) },
    precio,
    estado: 'Nuevo',
    descripcion: datos.descripcion,
    imagenPrincipal: {
      _type: 'image',
      asset: { _type: 'reference', _ref: imagenPrincipalAsset.asset._id },
    },
    ...(assetsGaleria.length > 0 ? {
      galeria: assetsGaleria.map((asset) => ({
        _type: 'image',
        _key: asset._id,
        asset: { _type: 'reference', _ref: asset._id },
      })),
    } : {}),
    categoria: { _type: 'reference', _ref: categoriaId },
    palabrasClave: datos.palabrasClave || [],
    ...(datos.marca ? { marca: datos.marca } : {}),
    ...(datos.capacidad ? { capacidad: datos.capacidad } : {}),
    ...(datos.edicion ? { edicion: datos.edicion } : {}),
    ...(datos.edadRecomendada ? { edadRecomendada: datos.edadRecomendada } : {}),
  };

  const creado = await client.create(documento);
  console.log(`  Listo. ID: ${creado._id}`);
  return creado;
}

async function main() {
  const [, , rutaCarpeta, categoriaTitulo] = process.argv;

  if (!rutaCarpeta || !categoriaTitulo) {
    console.error('Uso: node scripts/cargar-carpeta.mjs <ruta-carpeta> "<Nombre Categoria>"');
    process.exit(1);
  }

  console.log('Buscando la categoria en Sanity...');
  const categoria = await client.fetch(
    `*[_type == "categoria" && titulo == $titulo][0]{_id}`,
    { titulo: categoriaTitulo }
  );

  if (!categoria) {
    console.error(`No se encontro una categoria publicada con el titulo "${categoriaTitulo}".`);
    process.exit(1);
  }

  const archivos = fs.readdirSync(rutaCarpeta)
    .filter((nombre) => EXTENSIONES_VALIDAS.includes(path.extname(nombre).toLowerCase()));

  if (archivos.length === 0) {
    console.error('No se encontraron fotos validas en esa carpeta.');
    process.exit(1);
  }

  const grupos = agruparPorProducto(archivos);
  const claves = Object.keys(grupos).sort();

  console.log(`\nEncontrados ${claves.length} producto(s) (${archivos.length} foto(s) en total).\n`);

  const resultados = { exitosos: 0, fallidos: 0 };

  for (const clave of claves) {
    const fotosDelGrupo = grupos[clave];
    const nombresFotos = fotosDelGrupo.map((f) => f.archivo).join(', ');
    console.log(`\n--- Producto: ${clave} (${fotosDelGrupo.length} foto(s): ${nombresFotos}) ---`);

    const precioTexto = await preguntar(`Precio para "${clave}" (o escribe "saltar" para omitir): `);

    if (precioTexto.trim().toLowerCase() === 'saltar') {
      console.log('  Omitido.');
      continue;
    }

    const precio = Number(precioTexto);
    if (Number.isNaN(precio)) {
      console.log('  Precio invalido, se omite este producto.');
      resultados.fallidos++;
      continue;
    }

    try {
      await procesarProducto(rutaCarpeta, fotosDelGrupo, categoria._id, precio);
      resultados.exitosos++;
    } catch (error) {
      console.error(`  Error con ${clave}:`, error.message);
      resultados.fallidos++;
    }
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Creados con exito: ${resultados.exitosos}`);
  console.log(`Fallidos u omitidos: ${resultados.fallidos}`);

  rl.close();
}

main().catch((error) => {
  console.error('Ocurrio un error:', error.message);
  process.exit(1);
});
