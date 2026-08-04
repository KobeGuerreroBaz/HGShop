import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import sharp from 'sharp';
import { exec } from 'child_process';
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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function preguntar(texto) {
  return new Promise((resolve) => rl.question(texto, resolve));
}

function abrirFotoEnVistaPrevia(rutaCompleta) {
  exec(`open "${rutaCompleta}"`, (error) => {
    if (error) console.log('  (No se pudo abrir la vista previa automaticamente, no es grave)');
  });
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

function construirPrompt(contexto) {
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

function calcularHash(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
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

const EXTENSIONES_VALIDAS = ['.jpg', '.jpeg', '.png', '.webp'];
const CARPETA_YA_SUBIDO = 'ya-subido';
const NOMBRE_MANIFIESTO = '.ya-procesados.json';

function cargarManifiesto(rutaCarpeta) {
  const rutaManifiesto = path.join(rutaCarpeta, NOMBRE_MANIFIESTO);
  if (!fs.existsSync(rutaManifiesto)) return {};
  try {
    return JSON.parse(fs.readFileSync(rutaManifiesto, 'utf-8'));
  } catch {
    return {};
  }
}

function guardarManifiesto(rutaCarpeta, manifiesto) {
  const rutaManifiesto = path.join(rutaCarpeta, NOMBRE_MANIFIESTO);
  fs.writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2));
}

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

  for (const clave in grupos) {
    grupos[clave].sort((a, b) => a.orden - b.orden);
  }

  return grupos;
}

async function subirImagenComprimida(rutaCompleta) {
  const bufferOriginal = fs.readFileSync(rutaCompleta);
  const bufferComprimido = await comprimirParaSubida(bufferOriginal);
  const asset = await client.assets.upload('image', bufferComprimido, {
    filename: path.basename(rutaCompleta),
  });
  return asset;
}

function moverAYaSubido(rutaCarpeta, nombresArchivos) {
  const carpetaDestino = path.join(rutaCarpeta, CARPETA_YA_SUBIDO);
  if (!fs.existsSync(carpetaDestino)) {
    fs.mkdirSync(carpetaDestino, { recursive: true });
  }

  for (const nombre of nombresArchivos) {
    try {
      const origen = path.join(rutaCarpeta, nombre);
      const destino = path.join(carpetaDestino, nombre);
      if (fs.existsSync(origen)) {
        fs.renameSync(origen, destino);
      }
    } catch (error) {
      console.log(`  (No se pudo mover ${nombre}, pero ya quedo registrado como procesado: ${error.message})`);
    }
  }
}

function registrarEnManifiesto(rutaCarpeta, fotosDelGrupo, manifiesto, info) {
  for (const foto of fotosDelGrupo) {
    const rutaFoto = path.join(rutaCarpeta, foto.archivo);
    const buffer = fs.readFileSync(rutaFoto);
    const hash = calcularHash(buffer);
    manifiesto[hash] = { archivo: foto.archivo, fecha: new Date().toISOString(), ...info };
  }
  guardarManifiesto(rutaCarpeta, manifiesto);
}

async function buscarEnSanityPorHash(hash) {
  return client.fetch(`*[_type == "producto" && hashFoto == $hash][0]{_id, titulo}`, { hash });
}

async function procesarProducto(rutaCarpeta, fotosDelGrupo, categoriaId, precio, cantidad, contexto, manifiesto) {
  const primeraFoto = fotosDelGrupo[0].archivo;
  const rutaPrimeraFoto = path.join(rutaCarpeta, primeraFoto);

  console.log(`  1. Preparando foto principal (${primeraFoto})...`);
  const imageBufferOriginal = fs.readFileSync(rutaPrimeraFoto);
  const hashPrincipal = calcularHash(imageBufferOriginal);
  const imageBufferAnalisis = await redimensionarParaAnalisis(imageBufferOriginal);

  console.log('  2. Analizando con Gemini...');
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

  const prompt = construirPrompt(contexto);
  const result = await model.generateContent([prompt, imagePart]);
  const datos = JSON.parse(result.response.text());

  console.log(`  Titulo detectado: ${datos.titulo}`);

  console.log(`  3. Comprimiendo y subiendo ${fotosDelGrupo.length} foto(s) a Sanity...`);
  const imagenPrincipalAsset = await subirImagenComprimida(rutaPrimeraFoto);

  const fotosGaleria = fotosDelGrupo.slice(1);
  const assetsGaleria = [];
  for (const foto of fotosGaleria) {
    const rutaCompleta = path.join(rutaCarpeta, foto.archivo);
    const asset = await subirImagenComprimida(rutaCompleta);
    assetsGaleria.push(asset);
  }

  console.log('  4. Creando el producto...');
  const slugFinal = `${generarSlug(datos.titulo)}-${sufijoUnico(imagenPrincipalAsset._id)}`;

  const documento = {
    _type: 'producto',
    titulo: datos.titulo,
    slug: { _type: 'slug', current: slugFinal },
    ...(precio !== null ? { precio } : {}),
    ...(cantidad !== null ? { cantidadDisponible: cantidad } : {}),
    estado: 'Nuevo',
    descripcion: datos.descripcion,
    imagenPrincipal: {
      _type: 'image',
      asset: { _type: 'reference', _ref: imagenPrincipalAsset._id },
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
    hashFoto: hashPrincipal,
    ...(datos.marca ? { marca: datos.marca } : {}),
    ...(datos.capacidad ? { capacidad: datos.capacidad } : {}),
    ...(datos.edicion ? { edicion: datos.edicion } : {}),
    ...(datos.edadRecomendada ? { edadRecomendada: datos.edadRecomendada } : {}),
    ...(datos.altTexto ? { altTexto: datos.altTexto } : {}),
  };

  const creado = await client.create(documento);
  const avisos = [];
  if (precio === null) avisos.push('SIN PRECIO');
  if (cantidad === null) avisos.push('SIN CANTIDAD');
  const textoAviso = avisos.length > 0 ? ` (${avisos.join(', ')}, pendiente de completar)` : '';
  console.log(`  Listo. ID: ${creado._id} | Slug: ${slugFinal}${textoAviso}`);

  registrarEnManifiesto(rutaCarpeta, fotosDelGrupo, manifiesto, { productoId: creado._id });

  const nombresDeArchivos = fotosDelGrupo.map((f) => f.archivo);
  moverAYaSubido(rutaCarpeta, nombresDeArchivos);
  console.log(`  Foto(s) movida(s) a la subcarpeta "${CARPETA_YA_SUBIDO}" (y registrada(s) permanentemente como procesadas).`);

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

  const manifiesto = cargarManifiesto(rutaCarpeta);

  const archivosTodos = fs.readdirSync(rutaCarpeta, { withFileTypes: true })
    .filter((entrada) => entrada.isFile())
    .map((entrada) => entrada.name)
    .filter((nombre) => EXTENSIONES_VALIDAS.includes(path.extname(nombre).toLowerCase()));

  const archivos = [];
  let ignoradosPorManifiesto = 0;
  for (const nombre of archivosTodos) {
    const rutaCompleta = path.join(rutaCarpeta, nombre);
    const buffer = fs.readFileSync(rutaCompleta);
    const hash = calcularHash(buffer);
    if (manifiesto[hash]) {
      ignoradosPorManifiesto++;
    } else {
      archivos.push(nombre);
    }
  }

  if (ignoradosPorManifiesto > 0) {
    console.log(`(${ignoradosPorManifiesto} foto(s) ignorada(s) porque ya estaban registradas como procesadas previamente)`);
  }

  if (archivos.length === 0) {
    console.log('No hay fotos pendientes en esta carpeta.');
    process.exit(0);
  }

  const grupos = agruparPorProducto(archivos);
  const claves = Object.keys(grupos).sort();

  console.log(`\nEncontrados ${claves.length} producto(s) pendiente(s) (${archivos.length} foto(s) en total).\n`);

  const resultados = { completos: 0, incompletos: 0, fallidos: 0, marcadosExistentes: 0 };

  for (const clave of claves) {
    const fotosDelGrupo = grupos[clave];
    const nombresFotos = fotosDelGrupo.map((f) => f.archivo).join(', ');
    console.log(`\n--- Producto: ${clave} (${fotosDelGrupo.length} foto(s): ${nombresFotos}) ---`);

    const rutaPrimeraFoto = path.join(rutaCarpeta, fotosDelGrupo[0].archivo);
    const bufferPrimeraFoto = fs.readFileSync(rutaPrimeraFoto);
    const hashPrimeraFoto = calcularHash(bufferPrimeraFoto);
    const existeEnSanity = await buscarEnSanityPorHash(hashPrimeraFoto);

    if (existeEnSanity) {
      console.log(`  Ya existe en Sanity como "${existeEnSanity.titulo}" (subido desde otro dispositivo). Se omite.`);
      registrarEnManifiesto(rutaCarpeta, fotosDelGrupo, manifiesto, { nota: 'detectado ya existente en Sanity (subido desde celular u otro origen)' });
      moverAYaSubido(rutaCarpeta, fotosDelGrupo.map((f) => f.archivo));
      resultados.marcadosExistentes++;
      continue;
    }

    abrirFotoEnVistaPrevia(rutaPrimeraFoto);

    const precioTexto = await preguntar(`Precio para "${clave}" (Enter=no lo se, "saltar"=decidir despues, "existe"=ya esta en Sanity, no subir de nuevo): `);

    const respuesta = precioTexto.trim().toLowerCase();

    if (respuesta === 'saltar') {
      console.log('  Omitido por ahora (la foto se queda en la carpeta, se preguntara de nuevo despues).');
      continue;
    }

    if (respuesta === 'existe') {
      registrarEnManifiesto(rutaCarpeta, fotosDelGrupo, manifiesto, { nota: 'marcado manualmente como ya existente en Sanity' });
      moverAYaSubido(rutaCarpeta, fotosDelGrupo.map((f) => f.archivo));
      console.log('  Marcado como ya existente. No se creo ningun producto nuevo. No se volvera a preguntar por esta foto.');
      resultados.marcadosExistentes++;
      continue;
    }

    let precio = null;
    if (precioTexto.trim() !== '') {
      precio = Number(precioTexto);
      if (Number.isNaN(precio)) {
        console.log('  Precio invalido, se omite este producto.');
        resultados.fallidos++;
        continue;
      }
    }

    const cantidadTexto = await preguntar(`Cantidad disponible para "${clave}" (Enter si aun no la sabes): `);

    let cantidad = null;
    if (cantidadTexto.trim() !== '') {
      cantidad = Number(cantidadTexto);
      if (Number.isNaN(cantidad)) {
        console.log('  Cantidad invalida, se omite este producto.');
        resultados.fallidos++;
        continue;
      }
    }

    const contextoTexto = await preguntar(`Contexto extra para Gemini (Enter para omitir, ej: "es edicion 2019, coleccion limitada"): `);
    const contexto = contextoTexto.trim() !== '' ? contextoTexto.trim() : null;

    try {
      await procesarProducto(rutaCarpeta, fotosDelGrupo, categoria._id, precio, cantidad, contexto, manifiesto);
      if (precio === null || cantidad === null) {
        resultados.incompletos++;
      } else {
        resultados.completos++;
      }
    } catch (error) {
      console.error(`  Error con ${clave}:`, error.message);
      resultados.fallidos++;
    }
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Creados completos (precio y cantidad): ${resultados.completos}`);
  console.log(`Creados incompletos (falta precio y/o cantidad): ${resultados.incompletos}`);
  console.log(`Marcados como ya existentes: ${resultados.marcadosExistentes}`);
  console.log(`Fallidos u omitidos: ${resultados.fallidos}`);

  rl.close();
}

main().catch((error) => {
  console.error('Ocurrio un error:', error.message);
  process.exit(1);
});
