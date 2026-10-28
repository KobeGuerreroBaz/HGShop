// Página "Carritos · Revisar precios": compara tus Hot Wheels, Matchbox y Cars contra la base de vendedores. SIN IA.
//
// Uso (desde la raíz del repo) o con la app "Precios Carritos" del Dock:
//   node scripts/precios/revisar.mjs         (abre http://localhost:4400 en tu navegador)
//   node scripts/precios/revisar.mjs --sin-abrir   (no abre el navegador; lo usa la app)
//
// Desde la página también se agregan álbumes: corre el scraper de ~/Desktop/scraper-hotwheels y, al terminar,
// vuelve a armar la base sola. Desde el iPhone (misma red Wi-Fi) pide el mismo PIN que /subir (UPLOAD_PIN de .dev.vars).
//
// Qué escribe en Sanity: SOLO el campo "precio", y solo cuando le das "Guardar" a un producto.
// Lo demás (coincidencias y fotos confirmadas o rechazadas, palabras aprendidas, productos saltados)
// se guarda en scripts/salida/. Los precios nuevos se ven en el sitio después de tu deploy.

import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { exec, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createClient } from '@sanity/client';
import { crearBuscador, marcaCanonica, tokens, distintivas, numeroDe } from '../../src/lib/emparejar-precios.mjs';
import { armarBase, leerAlbum, CARPETA_SCRAPER_DEFECTO } from './armar-base.mjs';

const PUERTO = 4400;
const CARPETA_SCRAPER = process.env.CARPETA_SCRAPER || CARPETA_SCRAPER_DEFECTO;
const ABRIR_NAVEGADOR = !process.argv.includes('--sin-abrir');
const DEPARTAMENTOS = ['hot-wheels', 'cars', 'matchbox'];

// Etiquetas de "cotizado" (se buscan en el título del producto). Agrega o quita a tu gusto.
const COTIZADOS = [
  ['Gulf', /\bgulf\b/i],
  ['Skyline', /skyline|gt-?r\b|\br3[234]\b|kenmeri|hakosuka/i],
  ['Nissan', /nissan|datsun/i],
  ['Camioneta', /pick ?up|truck|camioneta|\bvan\b|bronco|f-?150|c-?10\b|\bram\b|tacoma|hilux|tundra|silverado|sierra|\bsuv\b|land cruiser|4x4/i],
];

const CARPETA = path.dirname(fileURLToPath(import.meta.url));
const SALIDA = path.resolve('scripts/salida');
const ARCHIVO_BASE = path.join(SALIDA, 'base-precios.json');
const ARCHIVO_EQUIV = path.join(SALIDA, 'equivalencias.json');
const ARCHIVO_ESTADO = path.join(SALIDA, 'revision-estado.json');

for (const nombre of ['SANITY_PROJECT_ID', 'SANITY_API_TOKEN']) {
  if (!process.env[nombre]) {
    console.error(`Falta ${nombre} en .env (corre el script desde la raíz de hgshop)`);
    process.exit(1);
  }
}
if (!fs.existsSync(ARCHIVO_BASE)) {
  console.log('No existe la base todavía: la armo ahora...');
  armarBase({ carpetaScraper: CARPETA_SCRAPER, carpetaSalida: SALIDA });
}

// PIN para entrar desde otro aparato (iPhone): el mismo UPLOAD_PIN de .dev.vars (o PIN_PRECIOS en .env)
function leerPin() {
  if (process.env.PIN_PRECIOS) return String(process.env.PIN_PRECIOS).trim();
  try {
    const m = fs.readFileSync('.dev.vars', 'utf-8').match(/^\s*UPLOAD_PIN\s*=\s*"?([^"\n]+)"?/m);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}
const PIN = leerPin();
// La cookie guarda una huella del PIN, no el PIN
const HUELLA_PIN = PIN ? crypto.createHash('sha256').update('carritos:' + PIN).digest('hex').slice(0, 32) : '';

const leerJson = (archivo, porDefecto) => {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf-8')); } catch { return porDefecto; }
};
const escribirJson = (archivo, datos) => fs.writeFileSync(archivo, JSON.stringify(datos, null, 1), 'utf-8');

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

// ---------- datos ----------
let base = leerJson(ARCHIVO_BASE, { precios: [] }).precios;
let buscador = crearBuscador(base);
let versionBase = Date.now();

/** Vuelve a armar la base (después de un álbum nuevo) y recarga el buscador sin reiniciar la página. */
function recargarBase() {
  const r = armarBase({ carpetaScraper: CARPETA_SCRAPER, carpetaSalida: SALIDA });
  base = r.base;
  buscador = crearBuscador(base);
  versionBase = Date.now();
  console.log(`  Base actualizada: ${base.length} precios de ${buscador.totalModelos} modelos`);
  return r;
}
const equiv = leerJson(ARCHIVO_EQUIV, {});
for (const k of ['confirmados', 'rechazados', 'fotosSi', 'fotosNo', 'fotosVersion', 'aprendidos']) equiv[k] ||= {};
equiv.decisiones ||= [];
const estado = leerJson(ARCHIVO_ESTADO, {});

// Novedades: al guardar un precio se anota qué álbumes había; lo que salga de álbumes posteriores es "nuevo".
const albumesActuales = () => [...new Set(base.map((a) => a.album).filter(Boolean))].sort();
{
  // Una sola vez: a los precios guardados antes de esto se les anotan los álbumes de hoy (para que no salgan todos como nuevos)
  let migrados = 0;
  for (const e of Object.values(estado)) if (e.estado === 'guardado' && !e.albumes) { e.albumes = albumesActuales(); migrados++; }
  if (migrados) { escribirJson(ARCHIVO_ESTADO, estado); console.log(`  Novedades: anoté los álbumes actuales a ${migrados} precios ya guardados`); }
}

console.log('Leyendo tus productos de Sanity...');
const productos = await client.fetch(
  `*[_type == "producto" && (
      categoria->departamento in $deps ||
      (categoria->departamento == "autos-a-escala" && (titulo match "matchbox" || marca match "matchbox"))
    )]{
    _id, titulo, precio, marca, edicion, cantidadDisponible, agotado,
    "imagen": imagenPrincipal.asset->url,
    "departamento": categoria->departamento,
    "categoria": categoria->titulo
  } | order(titulo asc)`,
  { deps: DEPARTAMENTOS }
);
const porId = new Map(productos.map((p) => [p._id, p]));

const conteo = {};
for (const p of productos) conteo[p.departamento] = (conteo[p.departamento] || 0) + 1;

const claveAv = (a) => `${a.album}|${a.foto}|${a.posiciones}`;
const textoProducto = (p) => `${p.titulo} ${p.edicion || ''}`;

/** Prepara candidatos para el navegador: quita rutas locales y aplica tus decisiones por foto. */
function preparar(candidatos, idProducto) {
  const no = new Set(equiv.fotosNo[idProducto] || []);
  const si = new Set(equiv.fotosSi[idProducto] || []);
  const ver = new Set(equiv.fotosVersion[idProducto] || []); // mismo carrito, otro color o año
  return candidatos
    .map((c) => {
      const av = c.avistamientos
        .filter((a) => !no.has(claveAv(a)))
        .map(({ archivoFoto, ...a }) => ({ ...a, clave: claveAv(a), tieneFoto: !!archivoFoto, fotoConfirmada: si.has(claveAv(a)), otraVersion: ver.has(claveAv(a)) }));
      if (!av.length) return null;
      const precios = av.map((a) => a.precio);
      return {
        ...c,
        avistamientos: av,
        min: Math.min(...precios),
        max: Math.max(...precios),
        veces: av.length,
        vendedores: [...new Set(av.map((a) => a.vendedor))],
        ocultas: c.avistamientos.length - av.length,
      };
    })
    .filter(Boolean);
}

function candidatosDe(p) {
  return preparar(
    buscador.buscar(textoProducto(p), {
      marca: marcaCanonica(p.titulo, p.marca || ''),
      confirmados: equiv.confirmados[p._id] || [],
      rechazados: equiv.rechazados[p._id] || [],
      aprendidos: equiv.aprendidos,
    }),
    p._id
  );
}

function paraNavegador(p) {
  const texto = textoProducto(p);
  const e = estado[p._id] || null;
  let candidatos = candidatosDe(p);
  if (e?.estado === 'guardado' && e.albumes) {
    const conocidos = new Set(e.albumes);
    candidatos = candidatos.map((c) => ({ ...c, avistamientos: c.avistamientos.map((a) => (a.album && !conocidos.has(a.album) ? { ...a, nuevo: true } : a)) }));
  }
  return {
    ...p,
    estado: e ? (({ albumes, ...resto }) => resto)(e) : null,
    cotizado: COTIZADOS.filter(([, re]) => re.test(texto)).map(([nombre]) => nombre),
    numero: numeroDe(texto),
    candidatos,
  };
}

// ---------- aprendizaje ----------
function registrar(p, key, decision, score) {
  equiv.decisiones.push({ fecha: new Date().toISOString(), id: p._id, titulo: p.titulo, modelo: key, decision, score: score ?? null });
}

/** Si al confirmar sobra exactamente una palabra de cada lado, se aprende que son equivalentes. */
function aprender(p, key) {
  const P = tokens(textoProducto(p));
  for (const t of [...P]) if (equiv.aprendidos[t]) P.push(equiv.aprendidos[t]);
  const G = key.split('|')[1]?.split(' ') || [];
  const util = (t) => t.length >= 2 && !/^\d+$/.test(t);
  const faltan = G.filter((t) => !P.includes(t) && util(t));
  const sobran = distintivas(P.filter((t) => !G.includes(t))).filter(util);
  if (faltan.length === 1 && sobran.length === 1 && !equiv.aprendidos[sobran[0]]) {
    equiv.aprendidos[sobran[0]] = faltan[0];
    console.log(`  Aprendido: "${sobran[0]}" = "${faltan[0]}"`);
  }
}

function confirmarGrupo(id, key) {
  const conf = new Set(equiv.confirmados[id] || []);
  const rech = new Set(equiv.rechazados[id] || []);
  conf.add(key);
  rech.delete(key);
  equiv.confirmados[id] = [...conf];
  equiv.rechazados[id] = [...rech];
}

// ---------- álbumes (scraper) ----------
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ARCHIVO_MAESTRO = path.join(CARPETA_SCRAPER, 'precios_maestro.json');
const ARCHIVO_VENDEDORES = path.join(SALIDA, 'vendedores.json'); // vendedores dados de alta aunque aún no tengan álbum

const slug = (t) =>
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Álbumes ya procesados, agrupados por vendedor (más reciente primero). */
function historialAlbumes() {
  const maestro = leerJson(ARCHIVO_MAESTRO, { albumes: [], filas: [] });
  const porAlbum = {};
  for (const f of maestro.filas || []) {
    const a = (porAlbum[f.album] ||= { filas: 0, revisar: 0, conPrecio: 0 });
    a.filas++;
    if (f.revisar) a.revisar++;
    if (typeof f.precioUnitario === 'number') a.conPrecio++;
  }
  const albumes = (maestro.albumes || []).map((nombre) => ({ nombre, ...leerAlbum(nombre), ...(porAlbum[nombre] || { filas: 0, revisar: 0 }) }));
  const extra = leerJson(ARCHIVO_VENDEDORES, []);
  const vendedores = [...new Set([...albumes.map((a) => a.vendedor), ...extra])].sort();
  const grupos = vendedores.map((v) => ({
    vendedor: v,
    albumes: albumes.filter((a) => a.vendedor === v).sort((x, y) => String(y.fecha).localeCompare(String(x.fecha))),
  }));
  return { grupos, vendedores, nombres: albumes.map((a) => a.nombre) };
}

// Un solo álbum a la vez
const trabajo = { activo: false, lineas: [], album: '', prueba: false, inicio: null, fin: null, codigo: null, costo: null, esperandoLogin: false, base: null };
let proceso = null;

function correrAlbum({ url, vendedor, fecha, prueba }) {
  const [anio, mes, dia] = String(fecha).split('-').map(Number);
  const nombre = `${slug(vendedor)}-${MESES_CORTOS[mes - 1]}${dia}`;
  const args = [path.join(CARPETA_SCRAPER, 'extraer_album.mjs'), prueba ? '3' : '0', url, ...(prueba ? [] : [nombre])];
  Object.assign(trabajo, { activo: true, lineas: [], album: nombre, vendedor, prueba, inicio: new Date().toISOString(), fin: null, codigo: null, costo: null, esperandoLogin: false, base: null });
  const agregar = (texto) => {
    for (const l of String(texto).split(/\r?\n/)) {
      if (!l.trim()) continue;
      trabajo.lineas.push(l);
      if (/No veo la foto/i.test(l)) trabajo.esperandoLogin = true;
      const c = l.match(/costo estimado ≈ \$([\d.]+) MXN/);
      if (c) trabajo.costo = Number(c[1]);
    }
    if (trabajo.lineas.length > 800) trabajo.lineas.splice(0, trabajo.lineas.length - 800);
  };
  agregar(`$ node extraer_album.mjs ${prueba ? '3' : '0'} "${url}"${prueba ? '' : ' ' + nombre}`);
  proceso = spawn(process.execPath, args, { cwd: CARPETA_SCRAPER, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  proceso.stdout.on('data', agregar);
  proceso.stderr.on('data', agregar);
  proceso.on('close', (codigo) => {
    trabajo.codigo = codigo;
    if (!prueba && codigo === 0) {
      try {
        const r = recargarBase();
        trabajo.base = { precios: r.base.length, modelos: buscador.totalModelos };
        agregar(`Base actualizada: ${r.base.length} precios. Recarga la página para ver los precios nuevos.`);
      } catch (e) {
        agregar(`[X] No pude actualizar la base: ${e.message}`);
      }
    }
    trabajo.activo = false;
    trabajo.esperandoLogin = false;
    trabajo.fin = new Date().toISOString();
    proceso = null;
  });
  return nombre;
}

// ---------- acceso desde otros aparatos (iPhone) ----------
const esLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
function tienePin(req) {
  if (esLocal(req)) return true;
  if (!PIN) return false;
  const cookie = String(req.headers.cookie || '');
  return cookie.split(/;\s*/).some((c) => c === `carritos=${HUELLA_PIN}`);
}
const intentos = new Map(); // IP → {n, desde}
function demasiadosIntentos(ip) {
  const ahora = Date.now();
  const r = intentos.get(ip) || { n: 0, desde: ahora };
  if (ahora - r.desde > 60_000) { r.n = 0; r.desde = ahora; }
  r.n++;
  intentos.set(ip, r);
  return r.n > 5;
}
const PAGINA_PIN = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carritos · PIN</title><style>body{font:16px -apple-system,system-ui,sans-serif;background:#f5f5f4;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#fff;border:1px solid #e7e5e4;border-radius:14px;padding:24px;width:min(320px,90vw)}h1{font-size:20px;margin:0 0 12px}
input,button{font:inherit;width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #d6d3d1;margin-top:8px}
button{background:#1c1917;color:#fff;border:0}p{color:#b91c1c;min-height:1.2em;margin:8px 0 0;font-size:14px}</style></head>
<body><form id="f"><h1>Carritos · Precios</h1><input id="pin" type="password" inputmode="numeric" placeholder="PIN" autofocus><button>Entrar</button><p id="e"></p></form>
<script>document.getElementById('f').onsubmit=async(ev)=>{ev.preventDefault();const r=await fetch('/api/entrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:document.getElementById('pin').value})});
if(r.ok)location.reload();else document.getElementById('e').textContent=(await r.json()).error||'PIN incorrecto';};</script></body></html>`;

// ---------- servidor ----------
function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (c) => {
      datos += c;
      if (datos.length > 100_000) reject(new Error('Petición muy grande'));
    });
    req.on('end', () => {
      try { resolve(datos ? JSON.parse(datos) : {}); } catch (e) { reject(e); }
    });
  });
}

function responder(res, codigo, datos) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(datos));
}

const TIPOS = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);
  try {
    // --- Protección: solo esta página puede mandar órdenes (no otra página web abierta en el navegador) ---
    if (req.method === 'POST') {
      const origen = req.headers.origin;
      const tipo = String(req.headers['content-type'] || '');
      if ((origen && new URL(origen).host !== req.headers.host) || !tipo.startsWith('application/json')) {
        return responder(res, 403, { error: 'Petición no permitida' });
      }
    }

    // --- PIN (solo fuera de la Mac) ---
    if (req.method === 'POST' && url.pathname === '/api/entrar') {
      if (!PIN) return responder(res, 403, { error: 'No hay PIN configurado (UPLOAD_PIN en .dev.vars)' });
      if (demasiadosIntentos(req.socket.remoteAddress)) return responder(res, 429, { error: 'Demasiados intentos, espera un minuto' });
      const { pin } = await leerCuerpo(req);
      if (String(pin || '') !== PIN) return responder(res, 401, { error: 'PIN incorrecto' });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `carritos=${HUELLA_PIN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}`,
      });
      return res.end('{"ok":true}');
    }
    if (!tienePin(req)) {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/foto/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(PAGINA_PIN);
      }
      return responder(res, 401, { error: 'Falta el PIN' });
    }

    // --- álbumes ---
    if (req.method === 'GET' && url.pathname === '/api/albumes') {
      return responder(res, 200, historialAlbumes());
    }
    if (req.method === 'POST' && url.pathname === '/api/album') {
      const { url: link, vendedor, fecha, prueba, confirmarRepetido } = await leerCuerpo(req);
      if (trabajo.activo) return responder(res, 409, { error: `Ya se está procesando "${trabajo.album}"` });
      if (!/^https:\/\/((www|web|m)\.)?facebook\.com\/photo/i.test(String(link || ''))) return responder(res, 400, { error: 'El link debe ser de una foto de Facebook (facebook.com/photo...)' });
      if (!String(vendedor || '').trim()) return responder(res, 400, { error: 'Falta el vendedor' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return responder(res, 400, { error: 'Falta la fecha del álbum' });
      if (!fs.existsSync(path.join(CARPETA_SCRAPER, 'extraer_album.mjs'))) return responder(res, 500, { error: `No encuentro el scraper en ${CARPETA_SCRAPER}` });
      if (!process.env.GEMINI_API_KEY) return responder(res, 500, { error: 'Falta GEMINI_API_KEY: abre la página con la app "Precios Carritos" o desde una terminal' });
      const [, mes, dia] = fecha.split('-').map(Number);
      const nombre = `${slug(vendedor)}-${MESES_CORTOS[mes - 1]}${dia}`;
      if (!prueba && historialAlbumes().nombres.includes(nombre) && !confirmarRepetido) {
        return responder(res, 409, { repetido: true, error: `El álbum "${nombre}" ya existe. Si lo vuelves a correr, se reemplaza.` });
      }
      const vendedores = leerJson(ARCHIVO_VENDEDORES, []);
      if (!vendedores.includes(vendedor.trim())) escribirJson(ARCHIVO_VENDEDORES, [...vendedores, vendedor.trim()]);
      const album = correrAlbum({ url: link, vendedor: vendedor.trim(), fecha, prueba: !!prueba });
      return responder(res, 200, { album });
    }
    if (req.method === 'GET' && url.pathname === '/api/album/estado') {
      const desde = Number(url.searchParams.get('desde') || 0);
      return responder(res, 200, { ...trabajo, total: trabajo.lineas.length, lineas: trabajo.lineas.slice(desde) });
    }
    if (req.method === 'POST' && url.pathname === '/api/album/continuar') {
      if (proceso) { proceso.stdin.end('\n'); trabajo.esperandoLogin = false; } // el scraper solo pregunta una vez
      return responder(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/album/detener') {
      if (proceso) proceso.kill('SIGINT'); // el scraper guarda lo que lleve
      return responder(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/apagar') {
      if (!esLocal(req)) return responder(res, 403, { error: 'Solo se puede apagar desde la Mac' });
      if (trabajo.activo) return responder(res, 409, { error: 'Hay un álbum procesándose; espera a que termine' });
      responder(res, 200, { ok: true });
      console.log('Apagado desde la página.');
      setTimeout(() => process.exit(0), 300);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(CARPETA, 'revisar.html')));
    }

    if (req.method === 'GET' && url.pathname === '/api/datos') {
      return responder(res, 200, {
        productos: productos.map(paraNavegador),
        base: { precios: buscador.totalAvistamientos, modelos: buscador.totalModelos },
        vendedores: [...new Set(base.map((a) => a.vendedor))],
        aprendidos: Object.keys(equiv.aprendidos).length,
        version: versionBase,
        local: esLocal(req),
        iphone: esLocal(req) && PIN
          ? Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PUERTO}`)
          : [],
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/foto/')) {
      const a = base[Number(url.pathname.slice(6))];
      if (!a?.archivoFoto || !fs.existsSync(a.archivoFoto)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        'Content-Type': TIPOS[path.extname(a.archivoFoto).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600', // la página pide /foto/N?v=<versión de la base>
      });
      return fs.createReadStream(a.archivoFoto).pipe(res);
    }

    if (req.method === 'GET' && url.pathname === '/api/buscar') {
      const q = url.searchParams.get('q') || '';
      const id = url.searchParams.get('id') || '';
      const encontrados = buscador.buscar(q, {
        rechazados: [...(equiv.confirmados[id] || []), ...(equiv.rechazados[id] || [])],
        max: 8,
        minimo: 0.3,
        aprendidos: equiv.aprendidos,
      });
      return responder(res, 200, { candidatos: preparar(encontrados, id) });
    }

    // Decisión sobre una coincidencia completa
    if (req.method === 'POST' && url.pathname === '/api/equivalencia') {
      const { id, key, accion, score } = await leerCuerpo(req);
      const p = porId.get(id);
      if (!p || !key) return responder(res, 400, { error: 'Producto o modelo inválido' });
      const conf = new Set(equiv.confirmados[id] || []);
      const rech = new Set(equiv.rechazados[id] || []);
      conf.delete(key);
      rech.delete(key);
      if (accion === 'confirmar') conf.add(key);
      if (accion === 'rechazar') rech.add(key);
      equiv.confirmados[id] = [...conf];
      equiv.rechazados[id] = [...rech];
      if (accion === 'confirmar' || accion === 'rechazar') registrar(p, key, accion === 'confirmar' ? 'si' : 'no', score);
      if (accion === 'confirmar') aprender(p, key);
      escribirJson(ARCHIVO_EQUIV, equiv);
      return responder(res, 200, { producto: paraNavegador(p) });
    }

    // Decisión sobre una sola foto de una coincidencia
    if (req.method === 'POST' && url.pathname === '/api/foto') {
      const { id, key, clave, accion, score } = await leerCuerpo(req);
      const p = porId.get(id);
      if (!p || !key || !clave) return responder(res, 400, { error: 'Datos incompletos' });
      const si = new Set(equiv.fotosSi[id] || []);
      const no = new Set(equiv.fotosNo[id] || []);
      const ver = new Set(equiv.fotosVersion[id] || []);
      si.delete(clave);
      no.delete(clave);
      ver.delete(clave);
      if (accion === 'si') {
        si.add(clave);
        confirmarGrupo(id, key);
        registrar(p, key, 'si-foto', score);
        aprender(p, key);
      }
      if (accion === 'no') {
        no.add(clave);
        registrar(p, key, 'no-foto', score);
      }
      // Otra versión: es el mismo carrito pero de otro color o año. Solo sirve de idea; no confirma ni enseña.
      if (accion === 'version') {
        ver.add(clave);
        registrar(p, key, 'version-foto', score);
      }
      equiv.fotosVersion[id] = [...ver];
      equiv.fotosSi[id] = [...si];
      equiv.fotosNo[id] = [...no];
      escribirJson(ARCHIVO_EQUIV, equiv);
      return responder(res, 200, { producto: paraNavegador(p) });
    }

    if (req.method === 'POST' && url.pathname === '/api/precio') {
      const { id, precio } = await leerCuerpo(req);
      const p = porId.get(id);
      const valor = Number(precio);
      if (!p) return responder(res, 400, { error: 'Producto no encontrado' });
      if (!Number.isFinite(valor) || valor <= 0) return responder(res, 400, { error: 'Precio inválido' });
      await client.patch(id).set({ precio: valor }).commit();
      const anterior = p.precio ?? null;
      p.precio = valor;
      estado[id] = { estado: 'guardado', precioAnterior: anterior, precio: valor, fecha: new Date().toISOString(), albumes: albumesActuales() };
      escribirJson(ARCHIVO_ESTADO, estado);
      console.log(`  Guardado: ${p.titulo}: ${anterior ?? 'sin precio'} → $${valor}`);
      return responder(res, 200, { producto: paraNavegador(p) });
    }

    // Novedades vistas: dejas tu precio igual y ya no sale en "Novedades"
    if (req.method === 'POST' && url.pathname === '/api/visto') {
      const { id } = await leerCuerpo(req);
      const p = porId.get(id);
      if (!p || estado[id]?.estado !== 'guardado') return responder(res, 400, { error: 'Producto no encontrado' });
      estado[id].albumes = albumesActuales();
      estado[id].visto = new Date().toISOString();
      escribirJson(ARCHIVO_ESTADO, estado);
      return responder(res, 200, { producto: paraNavegador(p) });
    }

    if (req.method === 'POST' && url.pathname === '/api/estado') {
      const { id, valor } = await leerCuerpo(req);
      const p = porId.get(id);
      if (!p) return responder(res, 400, { error: 'Producto no encontrado' });
      if (valor) estado[id] = { estado: valor, fecha: new Date().toISOString() };
      else delete estado[id];
      escribirJson(ARCHIVO_ESTADO, estado);
      return responder(res, 200, { producto: paraNavegador(p) });
    }

    res.writeHead(404);
    res.end();
  } catch (e) {
    console.error('  [X]', e.message);
    responder(res, 500, { error: e.message });
  }
});

/** Qué tanto aciertan las coincidencias según su puntaje (para calibrar el motor). */
function estadisticas() {
  const d = equiv.decisiones.filter((x) => typeof x.score === 'number' && x.score < 100);
  if (d.length < 5) return '';
  const rangos = [[80, 100], [60, 79], [40, 59]];
  return rangos
    .map(([a, b]) => {
      const r = d.filter((x) => x.score >= a && x.score <= b);
      if (!r.length) return null;
      const si = r.filter((x) => x.decision.startsWith('si')).length;
      return `${a}-${b}%: aceptas ${Math.round((si / r.length) * 100)}% (${r.length})`;
    })
    .filter(Boolean)
    .join(' · ');
}

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Ya estaba abierta (p. ej. se abrió la app dos veces): solo abre el navegador
    console.log(`La página ya estaba abierta en http://localhost:${PUERTO}`);
    if (ABRIR_NAVEGADOR && process.platform === 'darwin') exec(`open http://localhost:${PUERTO}`);
    process.exit(0);
  }
  throw e;
});

servidor.listen(PUERTO, PIN ? '0.0.0.0' : '127.0.0.1', () => {
  const conPrecio = productos.filter((p) => p.precio).length;
  console.log(`\nProductos: ${productos.length} (${conPrecio} con precio, ${productos.length - conPrecio} sin precio)`);
  for (const [d, n] of Object.entries(conteo)) console.log(`  ${d}: ${n}`);
  console.log(`Base: ${buscador.totalAvistamientos} precios de ${buscador.totalModelos} modelos`);
  const est = estadisticas();
  if (est) console.log(`Tus decisiones: ${est}`);
  if (Object.keys(equiv.aprendidos).length) console.log(`Palabras aprendidas: ${Object.keys(equiv.aprendidos).length}`);
  console.log(`\nAbierto en http://localhost:${PUERTO}  (Ctrl+C para cerrar)`);
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  if (PIN && ips.length) console.log(`Desde tu iPhone (misma red Wi-Fi): ${ips.map((ip) => `http://${ip}:${PUERTO}`).join('  ')}  (pide PIN)`);
  if (!PIN) console.log('Sin PIN configurado: la página solo abre en esta Mac.');
  if (ABRIR_NAVEGADOR && process.platform === 'darwin') exec(`open http://localhost:${PUERTO}`);
});
