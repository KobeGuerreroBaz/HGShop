export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request }) => {
  const { pin } = await request.json();

  const correcto = pin === env.UPLOAD_PIN;

  return new Response(JSON.stringify({ ok: correcto }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
