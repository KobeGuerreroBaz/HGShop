// arreglar-acentos.mjs — repone los acentos que faltan en títulos y descripciones.
//
// Por qué: 135 de 639 productos (21%) tienen la descripción sin acentos ("Vehiculo a escala",
// "Anade a tu coleccion", "diversion"). Esa descripción es la que Google muestra en los resultados
// y la que lee el cliente en la ficha. No hace falta IA: son siempre las mismas palabras.
//
//   node scripts/arreglar-acentos.mjs              <- SOLO MUESTRA lo que cambiaría (no toca nada)
//   node scripts/arreglar-acentos.mjs --aplicar    <- lo aplica en Sanity
//   node scripts/arreglar-acentos.mjs --aplicar --limite 10   <- solo los primeros 10, para probar
//
// Antes de aplicar guarda una copia de los textos originales en scripts/salida/respaldo-acentos-<fecha>.json,
// así se puede deshacer con:  node scripts/arreglar-acentos.mjs --deshacer <archivo>
//
// REGLA: aquí solo entran palabras SIN AMBIGÜEDAD. "coleccion" solo puede ser "colección".
// Palabras como "esta/está", "numero/número", "publico/público", "practico/práctico" o "termino/término"
// NO entran, porque sin acento también existen y cambiarlas puede romper la frase.

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@sanity/client';

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

// palabra sin acento -> con acento. Minúsculas; el script respeta la mayúscula inicial.
const PALABRAS = {
  accion: 'acción', acido: 'ácido', acompanado: 'acompañado', ademas: 'además',
  adicion: 'adición',
  aerodinamico: 'aerodinámico', aerodinamicos: 'aerodinámicos', aerodinamicas: 'aerodinámicas',
  aleman: 'alemán', aleron: 'alerón', ambar: 'ámbar',
  anade: 'añade', anaden: 'añaden', ano: 'año', anos: 'años',
  anticolicos: 'anticólicos', aromatica: 'aromática',
  autentico: 'auténtico', autentica: 'auténtica', autenticos: 'auténticos', autenticas: 'auténticas',
  automovil: 'automóvil', automoviles: 'automóviles',
  bano: 'baño', basica: 'básica', bateria: 'batería', baterias: 'baterías',
  batimovil: 'batimóvil', blister: 'blíster',
  calida: 'cálida', camion: 'camión', capo: 'capó',
  caracteristica: 'característica', caracteristicas: 'características',
  caracteristico: 'característico', caracteristicos: 'característicos',
  carroceria: 'carrocería', categoria: 'categoría', cautivaran: 'cautivarán',
  cinematografica: 'cinematográfica',
  clasico: 'clásico', clasica: 'clásica', clasicos: 'clásicos', clasicas: 'clásicas',
  clasificacion: 'clasificación', codigo: 'código',
  coleccion: 'colección', combinacion: 'combinación',
  comodo: 'cómodo', comoda: 'cómoda', construccion: 'construcción', corazon: 'corazón',
  cuadricula: 'cuadrícula', cupula: 'cúpula',
  decada: 'década', decoracion: 'decoración', despues: 'después',
  dia: 'día', dias: 'días', dinamico: 'dinámico', dinamica: 'dinámica',
  diseno: 'diseño', disenos: 'diseños', disenado: 'diseñado', disenada: 'diseñada', disenadas: 'diseñadas',
  diversion: 'diversión', diviertete: 'diviértete',
  economico: 'económico', edicion: 'edición', ediciones: 'ediciones',
  electrico: 'eléctrico', electrica: 'eléctrica', electricos: 'eléctricos',
  emblematico: 'emblemático', emblematica: 'emblemática', emblematicos: 'emblemáticos',
  emocion: 'emoción', encantara: 'encantará', epicas: 'épicas',
  escuderia: 'escudería', estetica: 'estética', exhibicion: 'exhibición',
  facil: 'fácil', faciles: 'fáciles', facilmente: 'fácilmente',
  fanatico: 'fanático', fanaticos: 'fanáticos',
  fantastico: 'fantástico', fantastica: 'fantástica', fascinaran: 'fascinarán',
  funcion: 'función',
  grafico: 'gráfico', graficos: 'gráficos',
  helicoptero: 'helicóptero', hialuronico: 'hialurónico',
  iconico: 'icónico', iconica: 'icónica', iconicos: 'icónicos',
  increible: 'increíble', increibles: 'increíbles', inscripcion: 'inscripción',
  japones: 'japonés', karite: 'karité',
  limite: 'límite', linea: 'línea', lineas: 'líneas', locion: 'loción',
  maletin: 'maletín', mas: 'más',
  metalico: 'metálico', metalica: 'metálica', metalicos: 'metálicos',
  multiples: 'múltiples', muneca: 'muñeca', murcielago: 'murciélago',
  neumaticos: 'neumáticos', ninos: 'niños',
  numeracion: 'numeración', numero: 'número',
  pasion: 'pasión', pedreria: 'pedrería', pelicula: 'película', peliculas: 'películas',
  pequeno: 'pequeño', pequena: 'pequeña', pequenos: 'pequeños', pequenas: 'pequeñas',
  permitiendote: 'permitiéndote', plastico: 'plástico', plastica: 'plástica',
  policia: 'policía', precision: 'precisión', presentacion: 'presentación', presion: 'presión',
  rapido: 'rápido', rapida: 'rápida', rapidos: 'rápidos', rapidas: 'rápidas',
  recomendacion: 'recomendación', replica: 'réplica', reventon: 'reventón', romantico: 'romántico',
  simbolo: 'símbolo', simpatico: 'simpático', subcoleccion: 'subcolección', superheroes: 'superhéroes',
  tamano: 'tamaño', tambien: 'también', tecnologia: 'tecnología', television: 'televisión',
  tematico: 'temático', tematica: 'temática', tematicos: 'temáticos', tematicas: 'temáticas',
  unico: 'único', unica: 'única', unicos: 'únicos', unicas: 'únicas',
  vehiculo: 'vehículo', vehiculos: 'vehículos', version: 'versión', versiones: 'versiones',
};

// FUERA A PROPÓSITO (revisado el 18 nov 2026 contra el catálogo real; no volver a agregarlas):
//   te      -> "té"      : "te" es pronombre ("te encantará", "permitiéndote"). 6 casos, todos pronombre.
//   comics  -> "cómics"  : es la marca DC Comics / Marvel Comics. 14 casos.
//   formula -> "fórmula" : aparece en nombres de serie en inglés de Hot Wheels. 12 casos.
//   maxima  -> "máxima"  : Nissan Maxima es un modelo de auto. 3 casos.
//   paris   -> "parís"   : nombre propio dentro de títulos en inglés. 4 casos.
//   cafe    -> "café"    : los 6 casos son el modelo "Honda CB750 Cafe" y "cafe racer", nombre en inglés.
//   practica / especifica: pueden ser verbos ("él practica", "se especifica"). 2 casos cada una.
// Las ambiguas de siempre (esta/está, este/esté, tu/tú, si/sí) tampoco entran: ver la regla de arriba.
// "si" es especialmente peligrosa: su único caso en el catálogo es "Honda Civic Si", la versión del auto.

// "mas" solo se acentúa cuando es cantidad; como conjunción ("pero") casi no se usa hoy.
// Aun así se deja fuera si va seguido de coma, por si acaso.
function arreglar(texto) {
  if (!texto) return texto;
  return texto.replace(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g, (palabra, i, completo) => {
    const baja = palabra.toLowerCase();
    const nueva = PALABRAS[baja];
    if (!nueva) return palabra;
    if (baja === 'mas' && completo.slice(i + 3, i + 4) === ',') return palabra;
    if (palabra[0] === palabra[0].toUpperCase()) return nueva[0].toUpperCase() + nueva.slice(1);
    if (palabra === palabra.toUpperCase()) return nueva.toUpperCase();
    return nueva;
  });
}

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const limite = Number((args[args.indexOf('--limite') + 1]) || 0) || 0;
const deshacer = args.includes('--deshacer') ? args[args.indexOf('--deshacer') + 1] : null;

if (deshacer) {
  const copia = JSON.parse(fs.readFileSync(deshacer, 'utf-8'));
  console.log(`\nDeshaciendo ${copia.length} productos desde ${deshacer}...\n`);
  let n = 0;
  for (const p of copia) {
    await client.patch(p._id).set({ titulo: p.titulo, descripcion: p.descripcion }).commit();
    n++;
    process.stdout.write(`  ${n}/${copia.length}\r`);
  }
  console.log(`\nListo: ${n} productos regresados a como estaban.\n`);
  process.exit(0);
}

const productos = await client.fetch('*[_type=="producto"]{_id, titulo, descripcion}');
const cambios = [];
for (const p of productos) {
  const titulo = arreglar(p.titulo || '');
  const descripcion = arreglar(p.descripcion || '');
  if (titulo !== (p.titulo || '') || descripcion !== (p.descripcion || '')) {
    cambios.push({ _id: p._id, antes: p, titulo, descripcion });
  }
}

const aTocar = limite ? cambios.slice(0, limite) : cambios;

console.log(`\n${productos.length} productos revisados · ${cambios.length} con acentos que faltan${limite ? ` · se tocarán ${aTocar.length}` : ''}\n`);

for (const c of aTocar.slice(0, aplicar ? 0 : 12)) {
  if (c.titulo !== c.antes.titulo) {
    console.log(`  TÍTULO`);
    console.log(`    antes:  ${c.antes.titulo}`);
    console.log(`    ahora:  ${c.titulo}`);
  }
  if (c.descripcion !== (c.antes.descripcion || '')) {
    const corte = (t) => t.slice(0, 110) + (t.length > 110 ? '…' : '');
    console.log(`  DESCRIPCIÓN (${c.antes.titulo.slice(0, 40)})`);
    console.log(`    antes:  ${corte(c.antes.descripcion || '')}`);
    console.log(`    ahora:  ${corte(c.descripcion)}`);
  }
  console.log('');
}

if (!aplicar) {
  if (cambios.length > 12) console.log(`  (se muestran 12 de ${cambios.length})\n`);
  console.log('Esto fue SOLO una vista previa; no se tocó nada.');
  console.log('Para aplicarlo:  node scripts/arreglar-acentos.mjs --aplicar\n');
  process.exit(0);
}

// --- aplicar ---
const carpeta = path.join('scripts', 'salida');
fs.mkdirSync(carpeta, { recursive: true });
const archivoCopia = path.join(carpeta, `respaldo-acentos-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
fs.writeFileSync(archivoCopia, JSON.stringify(aTocar.map((c) => c.antes), null, 2));
console.log(`Copia de los textos originales: ${archivoCopia}\n`);

let n = 0;
for (const c of aTocar) {
  await client.patch(c._id).set({ titulo: c.titulo, descripcion: c.descripcion }).commit();
  n++;
  process.stdout.write(`  aplicando ${n}/${aTocar.length}\r`);
}
console.log(`\n\nListo: ${n} productos corregidos.`);
console.log('Falta un deploy para que se vea en el sitio.');
console.log(`Si algo salió mal:  node scripts/arreglar-acentos.mjs --deshacer ${archivoCopia}\n`);
