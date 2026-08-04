export interface ItemCarrito {
  slug: string;
  titulo: string;
  numeroWhatsApp: string;
}

const CLAVE_CARRITO = 'hg_carrito';

function leerJSON<T>(clave: string, valorPorDefecto: T): T {
  if (typeof window === 'undefined') return valorPorDefecto;
  try {
    const crudo = window.localStorage.getItem(clave);
    return crudo ? JSON.parse(crudo) : valorPorDefecto;
  } catch {
    return valorPorDefecto;
  }
}

function guardarJSON(clave: string, valor: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // localStorage lleno o bloqueado; ignoramos silenciosamente
  }
}

export function obtenerCarrito(): ItemCarrito[] {
  return leerJSON<ItemCarrito[]>(CLAVE_CARRITO, []);
}

export function estaEnCarrito(slug: string): boolean {
  return obtenerCarrito().some((item) => item.slug === slug);
}

export function contarCarrito(): number {
  return obtenerCarrito().length;
}

export function agregarAlCarrito(item: ItemCarrito): void {
  const carrito = obtenerCarrito();
  if (carrito.some((p) => p.slug === item.slug)) return;
  carrito.push(item);
  guardarJSON(CLAVE_CARRITO, carrito);
}

export function quitarDelCarrito(slug: string): void {
  const carrito = obtenerCarrito().filter((item) => item.slug !== slug);
  guardarJSON(CLAVE_CARRITO, carrito);
}

export function estaBloqueado(): boolean {
  return contarCarrito() > 0;
}

export function construirEnvioCarrito(
  numeroDefault: string
): { numero: string; mensaje: string } | null {
  const carrito = obtenerCarrito();
  if (carrito.length === 0) return null;

  const conteosPorNumero = new Map<string, number>();
  carrito.forEach((item) => {
    conteosPorNumero.set(
      item.numeroWhatsApp,
      (conteosPorNumero.get(item.numeroWhatsApp) || 0) + 1
    );
  });

  let numeroGanador = numeroDefault;
  let maxCantidad = -1;
  conteosPorNumero.forEach((cantidad, numero) => {
    if (cantidad > maxCantidad) {
      maxCantidad = cantidad;
      numeroGanador = numero;
    } else if (cantidad === maxCantidad && numero === numeroDefault) {
      numeroGanador = numero;
    }
  });

  const slugs = carrito.map((item) => item.slug).join(',');
  const linkResumen = `https://hgstoremx.com/pedido?productos=${encodeURIComponent(slugs)}`;
  const mensaje = `Hola, quiero pedir estos productos:\n${linkResumen}`;

  return { numero: numeroGanador, mensaje };
}
