// Formas de datos compartidas entre las rutas /api/ y el panel /precios.
// Existen para que un cambio en lo que devuelve un endpoint (ej. renombrar
// un campo) truene en build en vez de mostrar "undefined" en pantalla —
// que es justo el bug que causó el mismatch entre departamentos.ts y precios.astro.

export interface DepartamentoConConteo {
  departamento: string;
  nombre: string;
  totalSinPrecio: number;
}

/** Forma que devuelven productos-sin-precio.ts y buscar-productos.ts, y que consume precios.astro. */
export interface ProductoParaAdmin {
  _id: string;
  titulo: string;
  precio?: number;
  cantidadDisponible?: number;
  marca?: string;
  palabrasClave?: string[];
  mostrarExistencias?: boolean;
  agotado?: boolean;
  categoriaTitulo?: string;
  imagenUrl: string | null;
}
