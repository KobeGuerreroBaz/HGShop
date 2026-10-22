// Motor de búsqueda del catálogo — un solo lugar para el inicio, los catálogos por
// departamento y /buscar (vista previa al compartir). Corre en el navegador sobre los
// productos que ya vienen en la página, así que es instantáneo y no cuesta nada.
//
// Qué hace:
// - Ignora acentos, mayúsculas y signos ("biberon" encuentra "biberón").
// - Palabras en cualquier orden ("batman hot wheels" = "Hot Wheels Batman").
// - Singular/plural y palabras a medio escribir ("termos" → "termo", "stan" → "Stanley").
// - Sinónimos mexicanos (lista SINONIMOS, editable).
// - Ordena: disponibles primero, luego lo que coincide en el título, luego el orden original.
// - Si no hay nada, intenta corregir errores de dedo ("stenley" → "stanley") y avisa.

// ---------------------------------------------------------------------------
// Sinónimos: cada grupo son formas de llamar a lo mismo. Se pueden agregar más.
// Escribir en minúsculas; acentos opcionales (se ignoran al comparar).
// ---------------------------------------------------------------------------
export const SINONIMOS: string[][] = [
  ['biberón', 'mamila', 'mamadera'],
  ['chupón', 'chupete', 'chupeta', 'pacificador'],
  ['termo', 'vaso térmico', 'tumbler', 'cilindro'],
  ['hot wheels', 'carrito', 'autito', 'cochecito'],
  ['mochila', 'backpack'],
  ['lonchera', 'lunchera', 'lunch box'],
  ['peluche', 'plush'],
  ['perfume', 'fragancia', 'colonia', 'body mist', 'splash'],
  ['crema', 'loción', 'body lotion'],
  ['jabón', 'gel de baño', 'body wash'],
  ['pañalera', 'bolsa de pañales', 'diaper bag'],
  ['taza', 'mug'],
  ['funko', 'cabezón'],
  ['audífonos', 'auriculares', 'headphones'],
];

// Palabras que no ayudan a encontrar nada ("termo de stanley" = "termo stanley").
const PALABRAS_VACIAS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas', 'y', 'o', 'en', 'con', 'para', 'por', 'a', 'al',
]);

/** Minúsculas, sin acentos, sin signos; espacios simples. */
export function normalizar(texto: string): string {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function palabras(texto: string): string[] {
  const n = normalizar(texto);
  return n ? n.split(' ') : [];
}

/** Quita plural simple: "biberones" → "biberon", "termos" → "termo". */
function raiz(palabra: string): string {
  if (palabra.length > 4 && palabra.endsWith('es')) return palabra.slice(0, -2);
  if (palabra.length > 3 && palabra.endsWith('s')) return palabra.slice(0, -1);
  return palabra;
}

/** Forma lista para guardar en el HTML (data-*) y buscar rápido. */
export function prepararTexto(titulo: string | null | undefined, palabrasClave?: string[] | null) {
  // Sanity devuelve null (no undefined) cuando el campo no existe.
  return {
    titulo: normalizar(titulo || ''),
    claves: normalizar((palabrasClave || []).filter((p) => typeof p === 'string').join(' ')),
  };
}

export interface ProductoBuscable<T = unknown> {
  titulo: string; // normalizado (ver prepararTexto)
  claves: string; // normalizado
  agotado?: boolean;
  dato: T; // lo que quieras recuperar (elemento del DOM, objeto, etc.)
}

interface Indice {
  tituloPalabras: string[];
  clavesPalabras: string[];
  tituloJunto: string;
  todoJunto: string;
}

const cacheIndices = new WeakMap<object, Indice>();
function indice(p: ProductoBuscable): Indice {
  let i = cacheIndices.get(p);
  if (!i) {
    const tituloPalabras = p.titulo ? p.titulo.split(' ') : [];
    const clavesPalabras = p.claves ? p.claves.split(' ') : [];
    i = {
      tituloPalabras,
      clavesPalabras,
      tituloJunto: tituloPalabras.join(''),
      todoJunto: tituloPalabras.concat(clavesPalabras).join(''),
    };
    cacheIndices.set(p, i);
  }
  return i;
}

function palabraCoincide(buscada: string, delProducto: string): boolean {
  const r = raiz(buscada);
  return (
    delProducto.startsWith(r) ||
    raiz(delProducto) === r ||
    (r.length >= 4 && delProducto.includes(r))
  );
}

/** Puntos de una palabra (o frase de sinónimo) en un producto: 3 título, 1 palabras clave, 0 no está. */
function puntosFrase(frase: string[], idx: Indice): number {
  const enLista = (lista: string[]) => frase.every((f) => lista.some((w) => palabraCoincide(f, w)));
  const junta = raiz(frase.join(''));
  if (enLista(idx.tituloPalabras) || (junta.length >= 5 && idx.tituloJunto.includes(junta))) {
    const exacta = frase.length === 1 && idx.tituloPalabras.includes(frase[0]);
    return exacta ? 4 : 3;
  }
  if (enLista(idx.clavesPalabras) || (junta.length >= 5 && idx.todoJunto.includes(junta))) return 1;
  return 0;
}

const gruposNormalizados = SINONIMOS.map((grupo) => grupo.map((t) => palabras(t)));

/** La palabra buscada + sus sinónimos (cada uno puede ser de varias palabras). */
function alternativas(palabra: string): string[][] {
  const r = raiz(palabra);
  const resultado: string[][] = [[palabra]];
  for (const grupo of gruposNormalizados) {
    const pertenece = grupo.some(
      (termino) => termino.length === 1 && (raiz(termino[0]) === r || (r.length >= 4 && termino[0].startsWith(r)))
    );
    if (pertenece) {
      for (const termino of grupo) resultado.push(termino);
    }
  }
  return resultado;
}

function terminosDeConsulta(consulta: string): string[] {
  const todas = palabras(consulta);
  const utiles = todas.filter((p) => !PALABRAS_VACIAS.has(p));
  return utiles.length > 0 ? utiles : todas;
}

/** Puntaje total; 0 si alguna palabra de la búsqueda no aparece. */
function puntuar(producto: ProductoBuscable, terminos: string[][][]): number {
  const idx = indice(producto);
  let total = 0;
  for (const alts of terminos) {
    let mejor = 0;
    for (const frase of alts) {
      mejor = Math.max(mejor, puntosFrase(frase, idx));
      if (mejor >= 4) break;
    }
    if (mejor === 0) return 0;
    total += mejor;
  }
  return total;
}

function ordenarYFiltrar<T>(productos: ProductoBuscable<T>[], terminos: string[][][]) {
  const conPuntos: { p: ProductoBuscable<T>; puntos: number; orden: number }[] = [];
  productos.forEach((p, orden) => {
    const puntos = puntuar(p, terminos);
    if (puntos > 0) conPuntos.push({ p, puntos, orden });
  });
  conPuntos.sort(
    (a, b) =>
      Number(!!a.p.agotado) - Number(!!b.p.agotado) || b.puntos - a.puntos || a.orden - b.orden
  );
  return conPuntos.map((c) => c.p);
}

// --- Corrección de errores de dedo -------------------------------------------

/** Distancia de edición (con transposición: "stnaley" está a 1 de "stanley"). */
function distancia(a: string, b: string, maximo: number): number {
  if (Math.abs(a.length - b.length) > maximo) return maximo + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let minFila = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      minFila = Math.min(minFila, d[i][j]);
    }
    if (minFila > maximo) return maximo + 1;
  }
  return d[a.length][b.length];
}

const cacheVocabulario = new WeakMap<object, Map<string, number>>();
function vocabulario(productos: ProductoBuscable[]): Map<string, number> {
  let v = cacheVocabulario.get(productos);
  if (!v) {
    v = new Map();
    for (const p of productos) {
      const idx = indice(p);
      for (const w of idx.tituloPalabras.concat(idx.clavesPalabras)) {
        if (w.length >= 3 && !/^\d+$/.test(w)) v.set(w, (v.get(w) || 0) + 1);
      }
    }
    cacheVocabulario.set(productos, v);
  }
  return v;
}

function corregirPalabra(palabra: string, vocab: Map<string, number>): string | null {
  if (palabra.length < 4 || /^\d+$/.test(palabra)) return null;
  const maximo = palabra.length >= 6 ? 2 : 1;
  let mejor: string | null = null;
  let mejorDist = maximo + 1;
  let mejorFrecuencia = 0;
  vocab.forEach((frecuencia, w) => {
    const dist = distancia(palabra, w, maximo);
    if (dist < mejorDist || (dist === mejorDist && dist <= maximo && frecuencia > mejorFrecuencia)) {
      mejor = w;
      mejorDist = dist;
      mejorFrecuencia = frecuencia;
    }
  });
  return mejorDist <= maximo ? mejor : null;
}

export interface ResultadoBusqueda<T> {
  resultados: ProductoBuscable<T>[];
  /** Si hubo que corregir la búsqueda, la búsqueda corregida (para el aviso). */
  correccion: string | null;
}

/** Busca, ordena y, si no hay nada, intenta corregir errores de dedo. */
export function buscar<T>(productos: ProductoBuscable<T>[], consulta: string): ResultadoBusqueda<T> {
  const terminos = terminosDeConsulta(consulta);
  if (terminos.length === 0) return { resultados: [], correccion: null };

  const resultados = ordenarYFiltrar(productos, terminos.map(alternativas));
  if (resultados.length > 0) return { resultados, correccion: null };

  // Sin resultados: corregir solo las palabras que no aparecen en ningún producto.
  const vocab = vocabulario(productos);
  let huboCambio = false;
  const corregidos = terminos.map((t) => {
    const alts = alternativas(t);
    const existe = productos.some((p) => alts.some((frase) => puntosFrase(frase, indice(p)) > 0));
    if (existe) return t;
    const correccion = corregirPalabra(t, vocab);
    if (correccion && correccion !== t) {
      huboCambio = true;
      return correccion;
    }
    return t;
  });
  if (!huboCambio) return { resultados: [], correccion: null };

  const corregidosResultados = ordenarYFiltrar(productos, corregidos.map(alternativas));
  return corregidosResultados.length > 0
    ? { resultados: corregidosResultados, correccion: corregidos.join(' ') }
    : { resultados: [], correccion: null };
}

// --- Para el navegador --------------------------------------------------------

/** Lee los productos de la página: elementos con data-titulo / data-claves / data-agotado. */
export function productosDesdeDom(selector: string): ProductoBuscable<HTMLElement>[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).map((el) => ({
    titulo: el.dataset.titulo || '',
    claves: el.dataset.claves || '',
    agotado: el.dataset.agotado === 'true',
    dato: el,
  }));
}

/** Link de WhatsApp para "¿No lo encuentras? Pregúntanos". */
export function linkPreguntarPorWhatsApp(numero: string, consulta: string): string {
  const mensaje = `Hola, busco: ${consulta}. Lo busqué en hgstoremx.com y no lo encontré, ¿lo tienen?`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * Guarda (sin datos personales) qué buscó la gente y cuántos resultados vio, para ver en
 * /inventario qué buscan y no encuentran. Espera a que dejen de escribir y no repite.
 */
export function crearRegistradorBusquedas(pagina: string, esperaMs = 1500) {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  let ultimoEnviado = '';

  function enviar(consulta: string, resultados: number) {
    const termino = consulta.trim().slice(0, 60);
    const clave = normalizar(termino);
    if (clave.length < 2 || clave === ultimoEnviado) return;
    ultimoEnviado = clave;
    const cuerpo = JSON.stringify({ termino, resultados, pagina });
    try {
      const enviado = navigator.sendBeacon?.('/api/registrar-busqueda', new Blob([cuerpo], { type: 'application/json' }));
      if (!enviado) {
        fetch('/api/registrar-busqueda', { method: 'POST', body: cuerpo, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
      }
    } catch {
      // El registro es opcional: nunca debe afectar la búsqueda.
    }
  }

  let pendiente: { consulta: string; resultados: number } | null = null;

  const registrador = {
    /** Llamar en cada cambio de búsqueda; se envía cuando dejan de escribir. */
    programar(consulta: string, resultados: number) {
      clearTimeout(temporizador);
      pendiente = { consulta, resultados };
      temporizador = setTimeout(() => registrador.vaciar(), esperaMs);
    },
    /** Enviar ya (al presionar "Buscar" o "Pregúntanos por WhatsApp"). */
    ahora(consulta: string, resultados: number) {
      clearTimeout(temporizador);
      pendiente = null;
      enviar(consulta, resultados);
    },
    /** Enviar lo que estaba esperando (ej. si cierran o salen de la página). */
    vaciar() {
      clearTimeout(temporizador);
      if (pendiente) enviar(pendiente.consulta, pendiente.resultados);
      pendiente = null;
    },
  };

  // Al salir de la página (cerrar pestaña, abrir un producto, ir a WhatsApp) se envía
  // lo pendiente para no perder búsquedas, sobre todo las que no encontraron nada.
  window.addEventListener('pagehide', () => registrador.vaciar());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') registrador.vaciar();
  });

  return registrador;
}
