// Página local para revisar tus precios contra la base de vendedores. SIN IA.
//
// Uso (desde la raíz del repo):
//   node scripts/precios/armar-base.mjs      (primero, y cada vez que agregues álbumes o vendedores)
//   node scripts/precios/revisar.mjs         (abre http://localhost:4400 en tu navegador)
//
// Qué escribe en Sanity: SOLO el campo "precio", y solo cuando le das "Guardar" a un producto.
// Lo demás (coincidencias y fotos confirmadas o rechazadas, palabras aprendidas, productos saltados)
// se guarda en scripts/salida/. Los precios nuevos se ven en el sitio después de tu deploy.

import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { createClient } from '@sanity/client';
import { crearBuscador, marcaCanonica, tokens, distintivas, numeroDe } from '../../src/lib/emparejar-precios.mjs';

const PUERTO = 4400;
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
  console.error('No existe la base. Corre primero: node scripts/precios/armar-base.mjs');
  process.exit(1);
}

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
const base = leerJson(ARCHIVO_BASE, { precios: [] }).precios;
const buscador = crearBuscador(base);
const equiv = leerJson(ARCHIVO_EQUIV, {});
for (const k of ['confirmados', 'rechazados', 'fotosSi', 'fotosNo', 'aprendidos']) equiv[k] ||= {};
equiv.decisiones ||= [];
const estado = leerJson(ARCHIVO_ESTADO, {});

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
  return candidatos
    .map((c) => {
      const av = c.avistamientos
        .filter((a) => !no.has(claveAv(a)))
        .map(({ archivoFoto, ...a }) => ({ ...a, clave: claveAv(a), tieneFoto: !!archivoFoto, fotoConfirmada: si.has(claveAv(a)) }));
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
  return {
    ...p,
    estado: estado[p._id] || null,
    cotizado: COTIZADOS.filter(([, re]) => re.test(texto)).map(([nombre]) => nombre),
    numero: numeroDe(texto),
    candidatos: candidatosDe(p),
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
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/foto/')) {
      const a = base[Number(url.pathname.slice(6))];
      if (!a?.archivoFoto || !fs.existsSync(a.archivoFoto)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        'Content-Type': TIPOS[path.extname(a.archivoFoto).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'max-age=3600',
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
      si.delete(clave);
      no.delete(clave);
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
      estado[id] = { estado: 'guardado', precioAnterior: anterior, precio: valor, fecha: new Date().toISOString() };
      escribirJson(ARCHIVO_ESTADO, estado);
      console.log(`  Guardado: ${p.titulo}: ${anterior ?? 'sin precio'} → $${valor}`);
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

servidor.listen(PUERTO, '127.0.0.1', () => {
  const conPrecio = productos.filter((p) => p.precio).length;
  console.log(`\nProductos: ${productos.length} (${conPrecio} con precio, ${productos.length - conPrecio} sin precio)`);
  for (const [d, n] of Object.entries(conteo)) console.log(`  ${d}: ${n}`);
  console.log(`Base: ${buscador.totalAvistamientos} precios de ${buscador.totalModelos} modelos`);
  const est = estadisticas();
  if (est) console.log(`Tus decisiones: ${est}`);
  if (Object.keys(equiv.aprendidos).length) console.log(`Palabras aprendidas: ${Object.keys(equiv.aprendidos).length}`);
  console.log(`\nAbierto en http://localhost:${PUERTO}  (Ctrl+C para cerrar)`);
  if (process.platform === 'darwin') exec(`open http://localhost:${PUERTO}`);
});
