// Formas de datos compartidas entre las rutas /api/ y el panel /inventario.
// Existen para que un cambio en lo que devuelve un endpoint (ej. renombrar
// un campo) truene en build en vez de mostrar "undefined" en pantalla —
// que es justo el bug que causó el mismatch entre departamentos.ts y inventario.astro.

export interface DepartamentoConConteo {
  departamento: string;
  nombre: string;
  totalSinPrecio: number;
}

/** Forma que devuelven productos-sin-precio.ts y buscar-productos.ts, y que consume inventario.astro. */
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
  /** _id de la categoría actual y su departamento (slug); se usan para mover el producto. */
  categoriaId?: string;
  departamento?: string;
  imagenUrl: string | null;
}

/** Lo que se guarda por cada término buscado en el catálogo (registrar-busqueda.ts). */
export interface MetadatosBusqueda {
  t: string; // cómo lo escribió la última persona
  n: number; // veces buscado
  sin: number; // veces sin resultados
  ultRes: number; // resultados la última vez
  ult: string; // fecha de la última vez (AAAA-MM-DD)
  pag: string; // página donde se buscó la última vez
}

/** Lo que se guarda por producto pedido o con "avísame" (registrar-pedido.ts). */
export interface MetadatosProductoPedido {
  s: string; // slug
  t: string; // título
  n: number; // veces
  ult: string; // fecha de la última vez (AAAA-MM-DD)
}

/** Forma que devuelve busquedas.ts y consume inventario.astro. */
export interface ResumenBusquedas {
  total: number;
  masBuscadas: MetadatosBusqueda[];
  sinResultados: MetadatosBusqueda[];
  masPedidos: MetadatosProductoPedido[];
  avisame: MetadatosProductoPedido[];
}
