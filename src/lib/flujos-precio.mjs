// Reglas de la "referencia de precio": qué productos la usan y con qué fuentes.
// JavaScript plano porque lo usan el sitio (Cloudflare y navegador) y los scripts de la Mac.
//
// La referencia NUNCA pone el precio: solo muestra lo que se encontró, con sus links,
// para que LeKobe decida.

/** Los 3 flujos que buscan precio. Todo lo demás no busca (ahorra tiempo y dinero). */
export const FLUJOS_PRECIO = {
  'autos-escala': 'Autos a escala',
  juguete: 'Juguetes',
  pokemon: 'Pokémon TCG',
};

/** Departamento (slug en Sanity) → flujo. Agregar aquí si se crea un departamento nuevo. */
export const FLUJO_POR_DEPARTAMENTO = {
  'hot-wheels': 'autos-escala',
  'autos-a-escala': 'autos-escala',
  m2: 'autos-escala',
  'green-light': 'autos-escala',
  cars: 'autos-escala',
  juguetes: 'juguete',
  'pokemon-tcg': 'pokemon',
};

export function esFlujoValido(flujo) {
  return typeof flujo === 'string' && Object.prototype.hasOwnProperty.call(FLUJOS_PRECIO, flujo);
}

/** null si el departamento no usa búsqueda de precio. */
export function flujoParaDepartamento(departamento) {
  return (departamento && FLUJO_POR_DEPARTAMENTO[departamento]) || null;
}

export const ETIQUETAS_TIPO_PRECIO = {
  tienda: 'precio de tienda',
  vendido: 'vendido',
  'precio-mercado': 'precio de mercado',
  reventa: 'reventa',
};

const texto = (valor, maximo) => (typeof valor === 'string' ? valor.trim().slice(0, maximo) : '');
const numero = (valor) => (typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 100) / 100 : null);
const urlSegura = (valor) => (typeof valor === 'string' && /^https?:\/\//i.test(valor) ? valor.slice(0, 600) : null);
const clave = () => Math.random().toString(36).slice(2, 10);

/**
 * Deja la referencia lista y segura para guardar en Sanity (campo interno
 * referenciaPrecio). Acepta lo que devuelve buscarReferenciaPrecio o lo que manda el
 * navegador; descarta lo que no tenga forma válida. null si no sirve.
 */
export function limpiarReferenciaPrecio(ref) {
  if (!ref || typeof ref !== 'object' || !esFlujoValido(ref.flujo)) return null;
  const precios = (Array.isArray(ref.precios) ? ref.precios : [])
    .slice(0, 10)
    .map((p) => ({
      _key: clave(),
      tienda: texto(p?.tienda, 80),
      dominio: texto(p?.dominio, 80),
      tipo: Object.prototype.hasOwnProperty.call(ETIQUETAS_TIPO_PRECIO, p?.tipo) ? p.tipo : 'tienda',
      precio: numero(p?.precio),
      moneda: p?.moneda === 'USD' ? 'USD' : 'MXN',
      mxn: numero(p?.mxn),
      url: urlSegura(p?.url),
      detalle: texto(p?.detalle, 160) || null,
    }))
    .filter((p) => p.tienda && p.precio !== null);
  const fuentes = (Array.isArray(ref.fuentes) ? ref.fuentes : [])
    .slice(0, 6)
    .map((f) => ({ _key: clave(), titulo: texto(f?.titulo, 120), url: urlSegura(f?.url) }))
    .filter((f) => f.titulo && f.url);
  return {
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(ref.fecha) ? ref.fecha : new Date().toISOString().slice(0, 10),
    flujo: ref.flujo,
    productoBuscado: texto(ref.productoBuscado, 200),
    alertaValor: texto(ref.alertaValor, 240) || null,
    tipoCambio: numero(ref.tipoCambio),
    nota: texto(ref.nota, 400) || null,
    precios,
    fuentes,
  };
}
