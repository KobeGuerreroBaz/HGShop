export const prerender = false;
import type { APIRoute } from 'astro';
import { nombreDepartamento } from '../../lib/sanity';
import { jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';
import type { DepartamentoConConteo } from '../../lib/tipos';

export const GET: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'departamentos');
  if (bloqueo) return bloqueo;

  const client = sanityClientEscritura();

  try {
    const productosSinPrecio: { departamento: string }[] = await client.fetch(
      `*[_type == "producto" && !defined(precio) && defined(categoria->departamento)]{
        "departamento": categoria->departamento
      }`
    );

    const conteoPorDepartamento = new Map<string, number>();
    productosSinPrecio.forEach(({ departamento }) => {
      conteoPorDepartamento.set(departamento, (conteoPorDepartamento.get(departamento) || 0) + 1);
    });

    const resultado: DepartamentoConConteo[] = Array.from(conteoPorDepartamento.entries())
      .map(([departamento, totalSinPrecio]) => ({
        departamento,
        nombre: nombreDepartamento(departamento),
        totalSinPrecio,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

    return jsonOk(resultado);
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
