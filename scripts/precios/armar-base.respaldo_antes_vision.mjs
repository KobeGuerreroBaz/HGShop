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
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const valor = (b) => {
  const i = args.indexOf(b);
  return i >= 0 ? args[i + 1] : undefined;
};
const expandir = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

export const CARPETA_SCRAPER_DEFECTO = path.join(os.homedir(), 'Desktop', 'scraper-hotwheels');

const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
const titulo = (s) => s.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/**
 * "mario-lopez-oct20" → { vendedor: "Mario Lopez", fecha: "2026-10-20", numero: 1 }
 * Si el mismo vendedor publicó más de un álbum ese día, el nombre lleva el número al final:
 * "alain-rodriguez-oct25-2" → { vendedor: "Alain Rodriguez", fecha: "2026-10-25", numero: 2 }
 */
export function leerAlbum(album) {
  const m = String(album).match(/^(.*?)-(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)(\d{1,2})(?:-(\d+))?$/i);
  if (!m) return { vendedor: titulo(album), fecha: '', numero: 1 };
  const hoy = new Date();
  const mes = MESES[m[2].toLowerCase()];
  const dia = Number(m[3]);
  let anio = hoy.getFullYear();
  if (new Date(anio, mes - 1, dia) > hoy) anio -= 1; // una fecha "futura" es del año pasado
  const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  return { vendedor: titulo(m[1]), fecha, numero: m[4] ? Number(m[4]) : 1 };
}

/**
 * Cuántos carritos trae una foto según su pie (para ubicar la posición en la foto).
 * "1-$80. 2-$85" → 2 · "$89/$39" → 2 · "F1\n80 30 35\n60 60 50" → 6 · "$55 c/u" → 0 (no se sabe).
 */
export function carritosDelPie(pie) {
  const t = String(pie || '');
  const porPos = [...t.matchAll(/(\d{1,2})\s*-\s*(?:\$\s*\d+|\d+\s*\$)/g)].map((m) => Number(m[1]));
  if (porPos.length) return Math.max(...porPos);
  if (/c\s*[\/)]\s*u|todos|lote|juntos/i.test(t)) return 0;
  const conSigno = t.match(/\$\s*\d+|\d+\s*\$/g);
  if (conSigno) return conSigno.length;
  let n = 0;
  for (const linea of t.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    if (/^[A-Za-z]{1,3}\s*\d{0,3}$/.test(linea)) continue; // rótulo "F1"
    const piezas = linea.split(/[\s,\/|]+/).filter(Boolean);
    if (piezas.some((p) => !/^\d{2,5}$/.test(p) && !/^[A-ZÁÉÍÓÚÑ.&-]{2,}$/.test(p))) return 0;
    n += piezas.filter((p) => /^\d{2,5}$/.test(p)).length;
  }
  return n;
}

/** Acepta www., web. y m.facebook.com y lo deja como www. (sin parámetros de redirección). */
export function limpiarUrlFacebook(url) {
  return url && /^https:\/\/((www|web|m)\.)?facebook\.com\//.test(url)
    ? url.replace(/^https:\/\/((web|m)\.)?facebook\.com\//, 'https://www.facebook.com/').replace(/&_rdc=\d+|&_rdr\b/g, '')
    : null;
}

/** Lo que guardó el scraper de una foto (debug/<album>_foto_NNN.json): link de Facebook y pie de foto. */
export function leerDebugFoto(carpetaScraper, album, foto) {
  const base = `${album}_foto_${String(foto).padStart(3, '0')}`;
  // Captura de pantalla de Facebook (el scraper la guarda cuando no pudo leer el pie como texto)
  const pantalla = fs.existsSync(path.join(carpetaScraper, 'debug', `${base}_pantalla.png`)) ? `${base}_pantalla.png` : null;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(carpetaScraper, 'debug', `${base}.json`), 'utf-8'));
    return { url: limpiarUrlFacebook(d.url || null), pie: d.pie || '', pantalla };
  } catch {
    return { url: null, pie: '', pantalla };
  }
}

/** Link de Facebook de una foto. */
export function linkFacebook(carpetaScraper, album, foto) {
  return leerDebugFoto(carpetaScraper, album, foto).url;
}

// ---------- Revisión de filas dudosas ("por revisar") ----------
// Las decisiones se guardan APARTE de precios_maestro.json (scripts/salida/revision-fotos.json),
// porque volver a correr un álbum reemplaza sus filas en el maestro y borraría las correcciones.
// Cada decisión se identifica por álbum + foto + posición, así que sigue aplicando si se vuelve a correr el álbum.
export const ARCHIVO_REVISION = 'revision-fotos.json';

/** Identificador estable de una fila del maestro: "album|foto|posiciones" (si no hay posiciones, se usa el modelo). */
export function claveFila(f) {
  const pos = String(f.posiciones ?? '').trim();
  return `${f.album}|${f.foto}|${pos || String(f.modelo || '').trim().toLowerCase()}`;
}

/** { clave: { accion: 'revisada' | 'descartada' | 'corregida', fecha, cambios?: {modelo, serie, numero, precio} } } */
export function leerRevision(carpetaSalida) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(carpetaSalida, ARCHIVO_REVISION), 'utf-8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

/** Lo que cambió una corrección, aplicado sobre la fila del maestro (solo campos con valor válido). */
export function aplicarCambios(f, cambios) {
  const c = cambios || {};
  const r = { ...f };
  if (typeof c.modelo === 'string' && c.modelo.trim()) r.modelo = c.modelo.trim();
  if (typeof c.serie === 'string') r.serie = c.serie.trim();
  if (typeof c.numero === 'string') r.numero = c.numero.trim();
  if (typeof c.precio === 'number' && c.precio > 0) {
    r.precioUnitario = c.precio;
    r.precioTotal = c.precio * (f.cantidad || 1);
  }
  return r;
}

/**
 * Filas marcadas "por revisar" en TODOS los álbumes del maestro, con el estado de su decisión.
 * Lee el maestro directo (no la base): las filas sin precio o de $30 o menos nunca llegan a la base.
 */
export function listarPorRevisar({ carpetaScraper = CARPETA_SCRAPER_DEFECTO, carpetaSalida = path.resolve('scripts/salida'), minimo = 30 } = {}) {
  const archivo = path.join(path.resolve(carpetaScraper), 'precios_maestro.json');
  if (!fs.existsSync(archivo)) return [];
  const maestro = JSON.parse(fs.readFileSync(archivo, 'utf-8'));
  const revision = leerRevision(path.resolve(carpetaSalida));
  const fotos = path.join(path.resolve(carpetaScraper), 'fotos_hotwheels');
  const infoFotos = new Map();
  // Posición más alta vista en cada foto (igual que en la base): sirve para resaltar la posición en el visor
  const maxPos = new Map();
  for (const f of maestro.filas || []) {
    const pos = String(f.posiciones || '').split(/[,\s]+/).map(Number).filter((n) => n > 0);
    if (pos.length) maxPos.set(`${f.album}|${f.foto}`, Math.max(maxPos.get(`${f.album}|${f.foto}`) || 0, ...pos));
  }
  const lista = [];
  for (const f of maestro.filas || []) {
    if (!f.revisar) continue;
    const clave = claveFila(f);
    const dec = revision[clave] || null;
    const k = `${f.album}|${f.foto}`;
    if (!infoFotos.has(k)) infoFotos.set(k, leerDebugFoto(path.resolve(carpetaScraper), f.album, f.foto));
    const info = infoFotos.get(k);
    const precio = typeof f.precioUnitario === 'number' ? f.precioUnitario : null;
    lista.push({
      clave,
      album: f.album,
      vendedor: leerAlbum(f.album).vendedor,
      foto: f.foto,
      posiciones: f.posiciones || '',
      marca: f.marca || 'Hot Wheels',
      modelo: f.modelo || '',
      serie: f.serie || '',
      numero: f.numero || '',
      precio,
      notas: f.notas || '',
      bajo: precio != null && precio <= Number(minimo), // la base lo ignora
      archivoFoto: f.archivoFoto && fs.existsSync(path.join(fotos, f.archivoFoto)) ? f.archivoFoto : null,
      url: info.url,
      pie: info.pie, // el texto que escribió el vendedor junto a la foto (ahí van los precios)
      pantalla: info.pantalla, // nombre del archivo de la captura de Facebook, si existe
      total: Math.max(carritosDelPie(info.pie), maxPos.get(k) || 0), // cuántos carritos trae la foto (0 = no se sabe)
      decision: dec ? { accion: dec.accion, fecha: dec.fecha || '', cambios: dec.cambios || null } : null,
    });
  }
  return lista;
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

/**
 * Arma la base y la guarda en <carpetaSalida>/base-precios.json.
 * La usan este script (desde la terminal) y la página de revisión (después de procesar un álbum).
 */
export function armarBase({ carpetaScraper = CARPETA_SCRAPER_DEFECTO, carpetaSalida = path.resolve('scripts/salida'), minimo = 30 } = {}) {
const CARPETA_SCRAPER = path.resolve(carpetaScraper);
const CARPETA_SALIDA = path.resolve(carpetaSalida);
const ARCHIVO_BASE = path.join(CARPETA_SALIDA, 'base-precios.json');
// Los precios de este valor o menos no se toman en cuenta (todos los vendedores)
const PRECIO_MINIMO = Number(minimo);
let bajos = 0;
const base = [];
const resumen = [];

// ---------- 1. Scraper de álbumes ----------
const archivoMaestro = path.join(CARPETA_SCRAPER, 'precios_maestro.json');
if (fs.existsSync(archivoMaestro)) {
  const maestro = JSON.parse(fs.readFileSync(archivoMaestro, 'utf-8'));
  let n = 0, conLink = 0;
  // Link de Facebook de cada foto: lo guardó el scraper en debug/<album>_foto_NNN.json
  const links = new Map();
  const pies = new Map();
  const linkDe = (album, foto) => {
    const k = `${album}|${foto}`;
    if (!links.has(k)) {
      const archivo = path.join(CARPETA_SCRAPER, 'debug', `${album}_foto_${String(foto).padStart(3, '0')}.json`);
      let url = null;
      try {
        const d = JSON.parse(fs.readFileSync(archivo, 'utf-8'));
        url = d.url || null;
        pies.set(k, d.pie || '');
      } catch {}
      links.set(k, limpiarUrlFacebook(url));
    }
    return links.get(k);
  };
  // Posición más alta que aparece en cada foto (incluye las filas que luego se filtran)
  const maxPos = new Map();
  for (const f of maestro.filas || []) {
    const k = `${f.album}|${f.foto}`;
    const pos = String(f.posiciones || '').split(/[,\s]+/).map(Number).filter((n) => n > 0);
    if (pos.length) maxPos.set(k, Math.max(maxPos.get(k) || 0, ...pos));
  }
  // Decisiones de la vista "Por revisar" (descartar / corregir / revisada), guardadas aparte del maestro
  const revision = leerRevision(CARPETA_SALIDA);
  let descartadas = 0, corregidas = 0;
  for (const filaMaestro of maestro.filas || []) {
    const decision = filaMaestro.revisar ? revision[claveFila(filaMaestro)] : null;
    if (decision?.accion === 'descartada') { descartadas++; continue; }
    const f = decision?.accion === 'corregida' ? aplicarCambios(filaMaestro, decision.cambios) : filaMaestro;
    if (decision?.accion === 'corregida') corregidas++;
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
      dudoso: !!f.revisar && !decision, // ya revisada o corregida = deja de ser dudosa
      notas: f.notas || '',
      archivoFoto: archivoFoto && fs.existsSync(archivoFoto) ? archivoFoto : null,
      url: linkDe(f.album, f.foto),
      // cuántos carritos trae la foto (para resaltar la posición): lo que diga el pie o la posición más alta vista
      totalFoto: Math.max(carritosDelPie(pies.get(`${f.album}|${f.foto}`)), maxPos.get(`${f.album}|${f.foto}`) || 0),
    });
    if (base[base.length - 1].url) conLink++;
    n++;
  }
  resumen.push(`Álbumes (${path.basename(CARPETA_SCRAPER)}): ${n} precios de ${(maestro.albumes || []).length} álbum(es), ${conLink} con link de Facebook`);
  if (descartadas || corregidas) resumen.push(`Revisión: ${descartadas} fila(s) descartada(s) y ${corregidas} corregida(s) a mano (revision-fotos.json)`);
} else {
  resumen.push(`[!] No encontré ${archivoMaestro}. Usa --scraper <carpeta> si lo moviste.`);
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
return { base, resumen, porVendedor, bajos, minimo: PRECIO_MINIMO, archivo: ARCHIVO_BASE };
}

// ---------- Desde la terminal ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = armarBase({
    carpetaScraper: expandir(valor('--scraper') || CARPETA_SCRAPER_DEFECTO),
    minimo: valor('--minimo') ?? 30,
  });
  console.log(r.resumen.join('\n'));
  console.log(`\nBase lista: ${r.base.length} precios (se dejaron fuera ${r.bajos} de $${r.minimo} o menos)`);
  for (const [v, n] of Object.entries(r.porVendedor)) console.log(`  ${v}: ${n}`);
  console.log(`Archivo: ${r.archivo}`);
}
