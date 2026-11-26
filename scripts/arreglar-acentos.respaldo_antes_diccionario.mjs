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
  anade: 'añade', anaden: 'añaden', ano: 'año', anos: 'años',
  automovil: 'automóvil', automoviles: 'automóviles',
  bateria: 'batería', baterias: 'baterías',
  caracteristica: 'característica', caracteristicas: 'características',
  clasico: 'clásico', clasica: 'clásica', clasicos: 'clásicos', clasicas: 'clásicas',
  coleccion: 'colección', colecciones: 'colecciones', coleccionista: 'coleccionista',
  comodo: 'cómodo', comoda: 'cómoda',
  decoracion: 'decoración', dias: 'días',
  diseno: 'diseño', disenos: 'diseños', disenado: 'diseñado', disenada: 'diseñada',
  diversion: 'diversión',
  economico: 'económico', edicion: 'edición', ediciones: 'ediciones',
  electrico: 'eléctrico', electrica: 'eléctrica',
  facil: 'fácil', faciles: 'fáciles',
  fantastico: 'fantástico', fantastica: 'fantástica',
  grafico: 'gráfico', graficos: 'gráficos',
  increible: 'increíble', increibles: 'increíbles',
  limitada: 'limitada', metalico: 'metálico', metalica: 'metálica',
  miniatura: 'miniatura', multiples: 'múltiples',
  pequeno: 'pequeño', pequena: 'pequeña', pequenos: 'pequeños', pequenas: 'pequeñas',
  plastico: 'plástico', plastica: 'plástica',
  rapido: 'rápido', rapida: 'rápida', rapidos: 'rápidos', rapidas: 'rápidas',
  resistente: 'resistente', simbolo: 'símbolo',
  tambien: 'también', unico: 'único', unica: 'única', unicos: 'únicos', unicas: 'únicas',
  vehiculo: 'vehículo', vehiculos: 'vehículos',
  version: 'versión', versiones: 'versiones',
  decada: 'década', deportivo: 'deportivo', emblematico: 'emblemático', emblematica: 'emblemática',
  autentico: 'auténtico', autentica: 'auténtica', clasificacion: 'clasificación',
  cafe: 'café', mas: 'más',
};

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
