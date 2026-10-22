// Registro anónimo (sin IP ni datos personales) de lo que piden los clientes:
// - 'pedido': productos de un carrito que se envió por WhatsApp.
// - 'avisame': agotados por los que alguien tocó "Avísame cuando vuelva a llegar".
// Se ve en /inventario → "Lo que buscan y piden tus clientes". Nunca debe afectar
// la experiencia del cliente: si falla, no pasa nada.

export type TipoEvento = 'pedido' | 'avisame';

export interface ProductoEvento {
  slug: string;
  titulo: string;
}

export function registrarEvento(tipo: TipoEvento, productos: ProductoEvento[]) {
  if (productos.length === 0) return;
  const cuerpo = JSON.stringify({ tipo, productos: productos.slice(0, 30) });
  try {
    const enviado = navigator.sendBeacon?.('/api/registrar-pedido', new Blob([cuerpo], { type: 'application/json' }));
    if (!enviado) {
      fetch('/api/registrar-pedido', {
        method: 'POST',
        body: cuerpo,
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {});
    }
  } catch {
    // Solo informativo.
  }
}
