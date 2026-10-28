// Motor para emparejar productos de HG Shop con la base de precios de vendedores.
// JavaScript plano, SIN IA y sin dependencias: lo usan los scripts de la Mac y (más adelante) el sitio.
//
// Idea: el nombre del casting en la base ("'08 Dodge Challenger SRT8") debe aparecer dentro del
// título del producto ("Hot Wheels Dodge Challenger SRT8 2008 HW Racing"). Se normalizan ambos textos,
// se quitan palabras de relleno y se mide qué tanto del casting está en el título. Las palabras raras
// ("skyline", "kdr30") pesan más que las comunes ("nissan", "ford").

const STOP = new Set(
  `hot wheels hotwheels matchbox disney pixar cars mattel hw mbx de del la el los las y the and of con with
  para en a an mainline premium edicion edition serie series nuevo nueva sellado sellada coleccion collection
  collector carrito carro coche auto autos escala modelo diecast blister tarjeta pieza
  rojo roja azul verde negro negra blanco blanca amarillo amarilla naranja gris plateado plata dorado dorada
  morado morada rosa cafe beige turquesa celeste vino guinda
  red blue green black white yellow orange gray grey silver gold purple pink brown`.split(/\s+/)
);

const SINONIMOS = {
  vw: 'volkswagen',
  chevy: 'chevrolet',
  lambo: 'lamborghini',
  porshe: 'porsche',
  bnr34: 'r34',
  bcnr33: 'r33',
  bnr32: 'r32',
  mercedesbenz: 'mercedes',
  benz: 'mercedes',
  pickup: 'pickup',
  camioneta: 'pickup',
  combi: 'bus',
};

const esAnio = (t) => /^(19[3-9]\d|20[0-4]\d)$/.test(t);

// Marcas de coches y palabras genéricas: por sí solas NO cuentan como "mismo modelo"
// (evita que un Aston Martin Vantage traiga todos los Aston Martin).
const MARCAS_AUTO = new Set(
  `aston martin nissan datsun ford chevrolet dodge toyota honda mazda porsche volkswagen bmw mercedes audi
  lamborghini ferrari mclaren jaguar lotus subaru mitsubishi plymouth pontiac buick cadillac lincoln jeep ram
  gmc chrysler mini fiat alfa romeo volvo tesla hyundai kia acura lexus infiniti bugatti koenigsegg pagani
  maserati lancia renault peugeot citroen opel land rover range shelby oldsmobile mercury amc studebaker
  hudson packard willys international kenworth peterbilt mack scania isuzu suzuki saab rivian hummer`.split(/\s+/)
);
const GENERICOS = new Set(
  `custom concept coupe convertible roadster wagon van truck pickup sedan special super sport sports turbo
  racing race rally street classic cruiser bus car gt`.split(/\s+/)
);
/** Palabras que identifican el modelo (no marca de coche, no genérica, no año). */
export function distintivas(toks) {
  return toks.filter((t) => !MARCAS_AUTO.has(t) && !GENERICOS.has(t) && !esAnio(t));
}

/** Texto → lista de palabras normalizadas (sin repetir). */
export function tokens(texto) {
  let t = String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  t = t
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ') // 24/250, 1/64, 5/10
    .replace(/#\s*\d+/g, ' ') // #233
    .replace(/[’‘`]/g, "'")
    .replace(/'(\d{2})\b/g, (_, y) => ` ${Number(y) > 30 ? '19' : '20'}${y} `); // '08 → 2008
  // une letras separadas por punto o guion: K.I.T.T. → kitt, GT-R → gtr, F-150 → f150
  let antes;
  do {
    antes = t;
    t = t.replace(/([a-z0-9])[.\-]([a-z0-9])/g, '$1$2');
  } while (t !== antes);
  const salida = [];
  for (let w of t.replace(/[^a-z0-9]+/g, ' ').split(' ')) {
    if (!w) continue;
    w = SINONIMOS[w] || w;
    if (STOP.has(w)) continue;
    if (w.length === 1 && !/\d/.test(w)) continue;
    if (!salida.includes(w)) salida.push(w);
  }
  return salida;
}

/**
 * Número de colección dentro de un texto: "177/250" (básico; se ignora el "2/5" de posición en la serie)
 * o "#865" (tarjeta vieja). Devuelve "" si no hay. Se normaliza sin ceros a la izquierda ("006/180" → "6/180").
 */
export function numeroDe(texto) {
  const t = String(texto || '');
  // "N/M" con M de 20 o más (250, 365, 100, 54...); "2/5" o "1/10" son la posición dentro de la serie
  const m = [...t.matchAll(/\b(\d{1,3})\s*\/\s*(\d{2,3})\b/g)].find((x) => Number(x[2]) >= 20);
  if (m) return `${Number(m[1])}/${Number(m[2])}`;
  const v = t.match(/(?:collector\s*(?:no\.?|#)?\s*|#\s*)(\d{1,4})\b/i);
  return v ? `#${Number(v[1])}` : '';
}
const normalizarNumero = (n) => {
  const t = String(n || '').trim();
  if (!t) return '';
  const m = t.match(/^(\d{1,4})\s*\/\s*(\d{1,4})$/);
  if (m) return `${Number(m[1])}/${Number(m[2])}`;
  const v = t.match(/^#\s*(\d{1,4})$/);
  return v ? `#${Number(v[1])}` : t;
};

/** Marca canónica a partir del texto (o del campo marca). */
export function marcaCanonica(...textos) {
  const t = textos.join(' ').toLowerCase();
  if (/matchbox/.test(t)) return 'Matchbox';
  if (/\b(cars|disney|pixar)\b/.test(t) && !/hot\s*wheels/.test(t)) return 'Cars';
  return 'Hot Wheels';
}

/** Clave estable de un modelo de la base (no cambia al reconstruir la base). */
export function claveModelo(marca, modelo) {
  return `${marcaCanonica(marca)}|${[...tokens(modelo)].sort().join(' ')}`;
}

/**
 * Crea el buscador a partir de la base (lista de avistamientos con {marca, modelo, ...}).
 * Agrupa los avistamientos del mismo modelo para mostrar todos sus precios juntos.
 */
export function crearBuscador(base) {
  const grupos = new Map();
  base.forEach((a, i) => {
    const toks = tokens(a.modelo);
    if (!toks.length) return;
    const key = claveModelo(a.marca, a.modelo);
    if (!grupos.has(key)) grupos.set(key, { key, marca: marcaCanonica(a.marca), toks, nombres: new Map(), avistamientos: [] });
    const g = grupos.get(key);
    g.nombres.set(a.modelo, (g.nombres.get(a.modelo) || 0) + 1);
    g.avistamientos.push({ ...a, i });
  });

  // Peso de cada palabra según qué tan rara es en la base
  const df = new Map();
  for (const g of grupos.values()) for (const t of g.toks) df.set(t, (df.get(t) || 0) + 1);
  const N = grupos.size || 1;
  const peso = (t) => {
    let w = Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
    if (esAnio(t)) w *= 0.5;
    else if (/^\d+$/.test(t)) w *= 0.7;
    return w;
  };

  const indice = new Map();
  for (const g of grupos.values()) {
    for (const t of g.toks) {
      if (!indice.has(t)) indice.set(t, []);
      indice.get(t).push(g);
    }
    g.nombre = [...g.nombres.entries()].sort((a, b) => b[1] - a[1])[0][0];
    g.avistamientos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  const cobertura = (de, en) => {
    let total = 0, dentro = 0;
    const set = new Set(en);
    for (const t of de) {
      const w = peso(t);
      total += w;
      if (set.has(t)) dentro += w;
    }
    return total ? dentro / total : 0;
  };

  /** Reglas mínimas: que coincida el modelo (no solo la marca) y, en nombres largos, al menos 3 palabras. */
  function pasaReglas(g, setProducto) {
    const comunes = g.toks.filter((t) => setProducto.has(t));
    const requeridas = g.toks.length >= 4 ? 3 : g.toks.length === 3 ? 2 : 1;
    if (comunes.length < requeridas) return false;
    const dist = distintivas(g.toks);
    if (dist.length) return dist.some((t) => setProducto.has(t));
    // sin palabras de modelo (ej. "'32 Ford", "Ford GT"): deben estar TODAS, incluido el año
    return g.toks.every((t) => setProducto.has(t));
  }

  function puntaje(g, toksProducto, marcaProducto) {
    let s = 0.75 * cobertura(g.toks, toksProducto) + 0.25 * cobertura(toksProducto, g.toks);
    if (marcaProducto && g.marca !== marcaProducto) s *= 0.6;
    return s;
  }

  /** Marca cada avistamiento según su número contra el del producto; los de mismo número van primero. */
  function conNumero(g, numProducto) {
    const av = g.avistamientos.map((a) => {
      const n = normalizarNumero(a.numero);
      return { ...a, numero: n, mismoNumero: !!(numProducto && n && n === numProducto), otroNumero: !!(numProducto && n && n !== numProducto) };
    });
    av.sort((a, b) => Number(b.mismoNumero) - Number(a.mismoNumero));
    return av;
  }

  function resumen(g, score, confirmado = false, numProducto = '', toksProducto = null) {
    const avistamientos = conNumero(g, numProducto);
    const precios = avistamientos.map((a) => a.precio).filter((p) => typeof p === 'number');
    const mismoNumero = avistamientos.some((a) => a.mismoNumero);
    const otroNumero = !mismoNumero && avistamientos.some((a) => a.otroNumero);
    // misma serie: las palabras de la serie de algún avistamiento aparecen en el título del producto
    const mismaSerie = !!toksProducto && avistamientos.some((a) => {
      const ts = distintivas(tokens(a.serie)).filter((t) => t.length >= 3);
      return ts.length > 0 && ts.every((t) => toksProducto.has(t));
    });
    if (!confirmado) {
      if (mismoNumero) score = Math.min(1, score + 0.15);
      else if (otroNumero) score = Math.max(0, score - 0.15);
      if (mismaSerie) score = Math.min(1, score + 0.05);
    }
    return {
      key: g.key,
      nombre: g.nombre,
      marca: g.marca,
      score: Math.round(score * 100),
      confirmado,
      mismoNumero,
      otroNumero,
      mismaSerie,
      min: precios.length ? Math.min(...precios) : null,
      max: precios.length ? Math.max(...precios) : null,
      veces: g.avistamientos.length,
      vendedores: [...new Set(g.avistamientos.map((a) => a.vendedor))],
      avistamientos,
    };
  }

  /**
   * Candidatos para un texto (título del producto o búsqueda manual).
   * opciones: { marca, confirmados: [keys], rechazados: [keys], max, minimo, aprendidos: {palabra: equivalente}, numero }
   * El número de colección del producto se toma de "numero" o, si no viene, del propio texto.
   */
  function buscar(texto, opciones = {}) {
    const { marca = null, confirmados = [], rechazados = [], max = 5, minimo = 0.4, aprendidos = {} } = opciones;
    const numProducto = normalizarNumero(opciones.numero ?? numeroDe(texto));
    const toks = tokens(texto);
    for (const t of [...toks]) if (aprendidos[t] && !toks.includes(aprendidos[t])) toks.push(aprendidos[t]);
    const setProducto = new Set(toks);
    const salida = [];
    for (const key of confirmados) {
      const g = grupos.get(key);
      if (g) salida.push(resumen(g, 1, true, numProducto, setProducto));
    }
    const vistos = new Set([...confirmados, ...rechazados]);
    const posibles = new Set();
    for (const t of toks) for (const g of indice.get(t) || []) if (!vistos.has(g.key)) posibles.add(g);
    const puntuados = [...posibles]
      .filter((g) => pasaReglas(g, setProducto))
      .map((g) => resumen(g, puntaje(g, toks, marca), false, numProducto, setProducto))
      .filter((r) => r.score >= minimo * 100)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, max - salida.length));
    salida.push(...puntuados);
    return salida;
  }

  return { buscar, totalModelos: grupos.size, totalAvistamientos: base.length };
}
