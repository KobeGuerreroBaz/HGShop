// Reglas de los subdepartamentos (las "categorías" de Sanity), en un solo lugar.
//
// Lo usan dos páginas que TIENEN que estar de acuerdo:
//   - catalogo/[departamento]/[categoria].astro  → genera las subpáginas
//   - catalogo/[departamento].astro              → enlaza cada sección a la suya
//
// Si la regla viviera copiada en los dos, el día que cambie el mínimo habría que
// acordarse de los dos lados y uno quedaría enlazando páginas que no existen.
// Es la misma historia de generarSlug() repetida en varios archivos, que ya
// costó el departamento duplicado Bebes/bebes.

/** Mínimo de productos para que un subdepartamento gane página propia. */
export const MINIMO_PRODUCTOS = 6;

export function quitarAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Minúsculas, sin acentos y sin la -s final, para comparar nombres sueltos. */
export function normalizarParaComparar(texto: string): string {
  let t = quitarAcentos(texto.toLowerCase().trim());
  if (t.endsWith('s') && t.length > 3) t = t.slice(0, -1);
  return t;
}

/** ¿La categoría se llama igual que su departamento? ("Hot Wheels" en hot-wheels) */
export function esRedundante(categoria: string, departamentoTexto: string): boolean {
  return normalizarParaComparar(categoria) === normalizarParaComparar(departamentoTexto);
}

/** ¿El nombre de la categoría ya trae dentro el del departamento? Ignora acentos,
 *  mayúsculas, espacios y signos, para que "Sets HotWheels Premium" cuente como
 *  que ya dice "Hot Wheels" y el título de la página no lo repita. */
export function yaIncluyeElNombre(texto: string, nombre: string): boolean {
  const aplanar = (s: string) => quitarAcentos(s.toLowerCase()).replace(/[^a-z0-9]/g, '');
  const aguja = aplanar(nombre);
  return aguja.length > 0 && aplanar(texto).includes(aguja);
}

/** Disponibles primero, agotados al final. Dentro de cada grupo se conserva el
 *  orden original, porque Array.sort es estable. */
export function disponiblesPrimero<T extends { agotado?: boolean }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => Number(Boolean(a.agotado)) - Number(Boolean(b.agotado)));
}

/** El slug tal como va en la URL. "Biberones" en Sanity → /bebes/biberones/.
 *  Si algún día se corrige ese slug en Sanity, la URL no cambia. */
export function slugDeCategoria(slug: string | undefined | null): string {
  return String(slug || '').toLowerCase();
}

/**
 * ¿Este subdepartamento lleva página propia? Tres condiciones, decididas por
 * código y no por una lista que haya que mantener a mano:
 *
 *   1. Tiene MINIMO_PRODUCTOS o más.
 *   2. No se llama como su departamento: la categoría "Hot Wheels" dentro del
 *      departamento hot-wheels sería un duplicado de la página de departamento.
 *   3. No es el departamento completo: si la categoría tiene TODOS los productos
 *      de su departamento (ej. "Vehículos" son los 45 de cars), su página sería
 *      un clon de /catalogo/cars/. La condición 2 NO lo detecta, porque los
 *      nombres no se parecen en nada; de ahí esta tercera.
 *
 * Así, cuando un subdepartamento crezca hasta el mínimo su página aparece sola
 * en el siguiente deploy. Y mientras esté a medio llenar simplemente no genera
 * página: no hay que borrar ni fusionar nada.
 */
export function tienePaginaPropia(opciones: {
  titulo: string;
  slug?: string | null;
  totalCategoria: number;
  totalDepartamento: number;
  nombreDepartamento: string;
}): boolean {
  const { titulo, slug, totalCategoria, totalDepartamento, nombreDepartamento } = opciones;
  if (!slugDeCategoria(slug)) return false;
  if (totalCategoria < MINIMO_PRODUCTOS) return false;
  if (esRedundante(titulo, nombreDepartamento)) return false;
  if (totalCategoria === totalDepartamento) return false;
  return true;
}
