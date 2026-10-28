// Junta en una sola base los precios de todos los vendedores.
//
// Uso (desde la raíz del repo):
//   node scripts/precios/armar-base.mjs
//   node scripts/precios/armar-base.mjs --scraper ~/ruta/a/scraper-hotwheels
//
// Fuentes:
//   1. precios_maestro.json del scraper de álbumes (por defecto ~/Desktop/scraper-hotwheels).
//      El vendedor y la fecha salen del nombre del álbum: "mario-lopez-oct20" → Mario Lopez, 20 oct.
//      Cualquier vendedor nuevo que proceses con el scraper (ej. "anny-oct20") entra solo.
//   2. Todos los archivos scripts/salida/precios-<vendedor>.csv con el formato de precios-joanna.csv.
//
// Salida: scripts/salida/base-precios.json (no se sube a GitHub). No usa IA ni toca Sanity.

import fs from 'fs';
import os from 'os';
import path from 'path';

const args = process.argv.slice(2);
const valor = (b) => {
  const i = args.indexOf(b);
  return i >= 0 ? args[i + 1] : undefined;
};
const expandir = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

const CARPETA_SCRAPER = path.resolve(expandir(valor('--scraper') || '~/Desktop/scraper-hotwheels'));
const CARPETA_SALIDA = path.resolve('scripts/salida');
const ARCHIVO_BASE = path.join(CARPETA_SALIDA, 'base-precios.json');
// Los precios de este valor o menos no se toman en cuenta (todos los vendedores)
const PRECIO_MINIMO = Number(valor('--minimo') ?? 30);
let bajos = 0;

const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
const titulo = (s) => s.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** "mario-lopez-oct20" → { vendedor: "Mario Lopez", fecha: "2026-10-20" } */
function leerAlbum(album) {
  const m = String(album).match(/^(.*?)-(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)(\d{1,2})$/i);
  if (!m) return { vendedor: titulo(album), fecha: '' };
  const hoy = new Date();
  const mes = MESES[m[2].toLowerCase()];
  const dia = Number(m[3]);
  let anio = hoy.getFullYear();
  if (new Date(anio, mes - 1, dia) > hoy) anio -= 1; // una fecha "futura" es del año pasado
  const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  return { vendedor: titulo(m[1]), fecha };
}

/** CSV simple con comillas. */
function leerCsv(texto) {
  const filas = [];
  let fila = [], campo = '', comillas = false;
  texto = texto.replace(/^﻿/, '');
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.some((x) => x !== '')) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x !== '')) filas.push(fila);
  const [encabezado, ...resto] = filas;
  return resto.map((f) => Object.fromEntries(encabezado.map((h, k) => [h.trim(), (f[k] ?? '').trim()])));
}

const base = [];
const resumen = [];

// ---------- 1. Scraper de álbumes ----------
const archivoMaestro = path.join(CARPETA_SCRAPER, 'precios_maestro.json');
if (fs.existsSync(archivoMaestro)) {
  const maestro = JSON.parse(fs.readFileSync(archivoMaestro, 'utf-8'));
  let n = 0, conLink = 0;
  // Link de Facebook de cada foto: lo guardó el scraper en debug/<album>_foto_NNN.json
  const links = new Map();
  const linkDe = (album, foto) => {
    const k = `${album}|${foto}`;
    if (!links.has(k)) {
      const archivo = path.join(CARPETA_SCRAPER, 'debug', `${album}_foto_${String(foto).padStart(3, '0')}.json`);
      let url = null;
      try { url = JSON.parse(fs.readFileSync(archivo, 'utf-8')).url || null; } catch {}
      // acepta www., web. y m.facebook.com, y lo deja como www. (sin parámetros de redirección)
      const limpio = url && /^https:\/\/((www|web|m)\.)?facebook\.com\//.test(url)
        ? url.replace(/^https:\/\/((web|m)\.)?facebook\.com\//, 'https://www.facebook.com/').replace(/&_rdc=\d+|&_rdr\b/g, '')
        : null;
      links.set(k, limpio);
    }
    return links.get(k);
  };
  for (const f of maestro.filas || []) {
    if (typeof f.precioUnitario !== 'number' || f.precioUnitario <= 0) continue;
    if (f.precioUnitario <= PRECIO_MINIMO) { bajos++; continue; }
    if (!f.modelo || f.modelo.startsWith('(')) continue;
    const { vendedor, fecha } = leerAlbum(f.album);
    const archivoFoto = f.archivoFoto ? path.join(CARPETA_SCRAPER, 'fotos_hotwheels', f.archivoFoto) : null;
    base.push({
      fuente: 'album',
      vendedor,
      fecha,
      album: f.album,
      foto: f.foto,
      posiciones: f.posiciones || '',
      marca: f.marca || 'Hot Wheels',
      modelo: f.modelo,
      serie: f.serie || '',
      numero: f.numero || '',
      especial: !!f.especial,
      cantidad: f.cantidad || 1,
      precio: f.precioUnitario,
      dudoso: !!f.revisar,
      notas: f.notas || '',
      archivoFoto: archivoFoto && fs.existsSync(archivoFoto) ? archivoFoto : null,
      url: linkDe(f.album, f.foto),
    });
    if (base[base.length - 1].url) conLink++;
    n++;
  }
  resumen.push(`Álbumes (${path.basename(CARPETA_SCRAPER)}): ${n} precios de ${(maestro.albumes || []).length} álbum(es), ${conLink} con link de Facebook`);
} else {
  console.warn(`[!] No encontré ${archivoMaestro}. Usa --scraper <carpeta> si lo moviste.`);
}

// ---------- 2. CSV por vendedor (precios-<vendedor>.csv) ----------
for (const nombre of fs.existsSync(CARPETA_SALIDA) ? fs.readdirSync(CARPETA_SALIDA) : []) {
  const m = nombre.match(/^precios-(.+)\.csv$/i);
  if (!m) continue;
  const vendedor = titulo(m[1]);
  let n = 0;
  for (const r of leerCsv(fs.readFileSync(path.join(CARPETA_SALIDA, nombre), 'utf-8'))) {
    const precio = Number(String(r.precio || '').replace(/[^\d.]/g, ''));
    if (!r.nombre || !precio || /^\(ilegible\)/i.test(r.nombre)) continue;
    if (precio <= PRECIO_MINIMO) { bajos++; continue; }
    base.push({
      fuente: 'csv',
      vendedor,
      fecha: (r.fecha || '').replace(/\s*\(aprox\)\s*/i, ''),
      album: nombre,
      foto: r.orden ? Number(r.orden) : null,
      posiciones: r.lado || '',
      marca: r.marca || r.nombre,
      modelo: r.nombre,
      serie: '',
      cantidad: 1,
      precio,
      dudoso: r.confianza ? r.confianza.toLowerCase() !== 'alta' : false,
      notas: [r.notas, r.confianza ? `confianza ${r.confianza}` : ''].filter(Boolean).join(' · '),
      archivoFoto: null,
      url: r.fbid ? `https://www.facebook.com/photo/?fbid=${r.fbid}` : null,
    });
    n++;
  }
  resumen.push(`${nombre}: ${n} precios (${vendedor})`);
}

fs.mkdirSync(CARPETA_SALIDA, { recursive: true });
fs.writeFileSync(ARCHIVO_BASE, JSON.stringify({ generada: new Date().toISOString(), precios: base }, null, 1), 'utf-8');

const porVendedor = {};
for (const a of base) porVendedor[a.vendedor] = (porVendedor[a.vendedor] || 0) + 1;
console.log(resumen.join('\n'));
console.log(`\nBase lista: ${base.length} precios (se dejaron fuera ${bajos} de $${PRECIO_MINIMO} o menos)`);
for (const [v, n] of Object.entries(porVendedor)) console.log(`  ${v}: ${n}`);
console.log(`Archivo: ${ARCHIVO_BASE}`);
