export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { demasiadasSolicitudes, excedeLimite, jsonOk } from '../../lib/api-utils';

export const POST: APIRoute = async ({ request }) => {
  if (await excedeLimite(request, 'verificar-pin')) {
    return demasiadasSolicitudes();
  }

  const { pin } = (await request.json()) as { pin?: string };

  const correcto = pin === env.UPLOAD_PIN;

  return jsonOk({ ok: correcto });
};
