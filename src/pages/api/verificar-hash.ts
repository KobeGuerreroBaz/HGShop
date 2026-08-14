export const prerender = false;
import type { APIRoute } from 'astro';
import { jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';

export const POST: APIRoute = async ({ request }) => {
  const bloqueo = await verificarAcceso(request, 'verificar-hash');
  if (bloqueo) return bloqueo;

  const { hash } = (await request.json()) as { hash?: string };

  const client = sanityClientEscritura();

  try {
    const existente = await client.fetch(
      `*[_type == "producto" && hashFoto == $hash][0]{_id, titulo}`,
      { hash }
    );

    return jsonOk({ existe: !!existente, producto: existente || null });
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
