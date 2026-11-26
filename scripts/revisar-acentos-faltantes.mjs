// revisar-acentos-faltantes.mjs — SOLO LEE. No modifica Sanity ni ningún archivo.
//
// Para qué: el diccionario de arreglar-acentos.mjs se queda corto (deja "camion",
// "pelicula", "fanaticos", "magnifica"). Este script propone qué palabras agregarle,
// usando como diccionario el propio catálogo: unas 500 fichas están bien escritas,
// así que si "película" ya existe acentuada en algún producto, entonces "pelicula"
// en otro producto es un acento perdido, no una palabra distinta.
//
//   node scripts/revisar-acentos-faltantes.mjs
//
// No recibe banderas. No escribe nada. Solo imprime tres listas.

import 'dotenv/config';
import { createClient } from '@sanity/client';

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

// Palabras que SIN acento también existen con otro significado. No se descartan:
// se mandan a una lista aparte para revisarlas a mano.
const AMBIGUAS = new Set([
  'esta', 'estas', 'este', 'el', 'mas', 'mi', 'tu', 'si', 'aun', 'solo',
  'numero', 'publico', 'practico', 'termino', 'titulo', 'articulo', 'limite',
  'calculo', 'continuo', 'medico', 'critico', 'capitulo', 'animo', 'valido',
  'habito', 'deposito', 'diagnostico', 'estimulo', 'intimo', 'liquido',
  'transito', 'domino', 'celebre', 'integro', 'circulo', 'vinculo', 'ultimo',
]);

const sinAcentos = (p) => p.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PALABRA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g;
const tildada = (p) => /[áéíóúüñÁÉÍÓÚÜÑ]/.test(p);
const recorte = (t, i) => ('…' + t.slice(Math.max(0, i - 45), i + 45) + '…').replace(/\s+/g, ' ');

console.log('\nLeyendo el catálogo (solo lectura)...');
const productos = await client.fetch('*[_type=="producto"]{_id, titulo, descripcion}');
const textos = productos.flatMap((p) => [p.titulo || '', p.descripcion || '']).filter(Boolean);
console.log(`${productos.length} productos · ${textos.length} textos\n`);

// 1) Vocabulario del propio catálogo: formas acentuadas que TÚ ya escribiste bien.
const bienEscritas = new Map(); // "pelicula" -> Map("película" -> 12)
for (const texto of textos) {
  for (const palabra of texto.match(PALABRA) || []) {
    if (!tildada(palabra)) continue;
    const llave = sinAcentos(palabra);
    const variante = palabra.toLowerCase();
    if (!bienEscritas.has(llave)) bienEscritas.set(llave, new Map());
    const variantes = bienEscritas.get(llave);
    variantes.set(variante, (variantes.get(variante) || 0) + 1);
  }
}

// 2) Palabras sin acento que tienen gemela acentuada en el catálogo.
const candidatas = new Map(); // "pelicula" -> { veces, ejemplo }
for (const texto of textos) {
  for (const encontrado of texto.matchAll(PALABRA)) {
    const palabra = encontrado[0];
    if (tildada(palabra)) continue;
    const llave = palabra.toLowerCase();
    if (!bienEscritas.has(llave)) continue;
    if (!candidatas.has(llave)) candidatas.set(llave, { veces: 0, ejemplo: recorte(texto, encontrado.index) });
    candidatas.get(llave).veces++;
  }
}

const propuesta = (llave) => {
  const variantes = [...bienEscritas.get(llave).entries()].sort((a, b) => b[1] - a[1]);
  return { forma: variantes[0][0], dudosa: variantes.length > 1, todas: variantes };
};

const claras = [];
const revisar = [];
for (const [llave, datos] of candidatas) {
  const { forma, dudosa, todas } = propuesta(llave);
  const fila = { llave, forma, veces: datos.veces, ejemplo: datos.ejemplo, todas };
  if (AMBIGUAS.has(llave) || dudosa) revisar.push(fila);
  else claras.push(fila);
}
claras.sort((a, b) => b.veces - a.veces);
revisar.sort((a, b) => b.veces - a.veces);

console.log('═══ 1. CLARAS — para agregar al diccionario ═══\n');
if (claras.length === 0) console.log('  (ninguna)\n');
for (const f of claras) console.log(`  ${f.llave.padEnd(18)} -> ${f.forma.padEnd(18)} ${String(f.veces).padStart(3)}x`);

console.log('\n═══ 2. PARA REVISAR A MANO — ambiguas o con varias formas ═══\n');
if (revisar.length === 0) console.log('  (ninguna)\n');
for (const f of revisar) {
  const formas = f.todas.length > 1 ? ` [varias: ${f.todas.map(([v, n]) => `${v} ${n}x`).join(', ')}]` : '';
  console.log(`  ${f.llave.padEnd(18)} -> ${f.forma.padEnd(18)} ${String(f.veces).padStart(3)}x${formas}`);
  console.log(`      ${f.ejemplo}`);
}

console.log('\n═══ 3. LAS DOS RIESGOSAS QUE YA ESTÁN EN EL DICCIONARIO ═══\n');
for (const riesgosa of ['mas', 'cafe']) {
  const casos = [];
  for (const texto of textos) {
    for (const encontrado of texto.matchAll(PALABRA)) {
      if (encontrado[0].toLowerCase() !== riesgosa) continue;
      casos.push(recorte(texto, encontrado.index));
    }
  }
  console.log(`  "${riesgosa}" aparece ${casos.length} vez/veces:`);
  for (const caso of casos.slice(0, 8)) console.log(`      ${caso}`);
  if (casos.length > 8) console.log(`      (y ${casos.length - 8} más)`);
  console.log('');
}

console.log('Esto fue solo lectura: no se tocó Sanity ni ningún archivo.\n');
