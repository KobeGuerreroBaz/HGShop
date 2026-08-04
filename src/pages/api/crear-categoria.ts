export const prerender = false;
import type { APIRoute } from 'astro';
import { createClient } from '@sanity/client';
import { env } from 'cloudflare:workers';

function pinValido(request: Request) {
  const pin = request.headers.get('x-upload-pin');
  return pin === env.UPLOAD_PIN;
}

function generarSlug(texto: string) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const CONFIG_WHATSAPP_ID = 'configuracionWhatsApp';

export const POST: APIRoute = async ({ request }) => {
  if (!pinValido(request)) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }

  try {
    const { titulo, departamento, numeroWhatsApp, nombreDepartamento } = await request.json() as {
      titulo: string;
      departamento: string;
      numeroWhatsApp?: string;
      nombreDepartamento?: string;
    };

    if (!titulo || !titulo.trim()) {
      return new Response(JSON.stringify({ error: 'El titulo de la categoria es requerido' }), { status: 400 });
    }
    if (!departamento || !departamento.trim()) {
      return new Response(JSON.stringify({ error: 'El departamento es requerido' }), { status: 400 });
    }

    const client = createClient({
      projectId: env.SANITY_PROJECT_ID,
      dataset: 'production',
      apiVersion: '2024-01-01',
      token: env.SANITY_API_TOKEN,
      useCdn: false,
    });

    const departamentoSlug = generarSlug(departamento);
    const tituloSlug = generarSlug(titulo.trim());

    const creada = await client.create({
      _type: 'categoria',
      titulo: titulo.trim(),
      slug: { _type: 'slug', current: tituloSlug },
      departamento: departamentoSlug,
    });

    const hayNumeroNuevo = numeroWhatsApp && numeroWhatsApp.trim();
    const hayNombreBonitoNuevo = nombreDepartamento && nombreDepartamento.trim();

    if (hayNumeroNuevo || hayNombreBonitoNuevo) {
      await client.createIfNotExists({
        _id: CONFIG_WHATSAPP_ID,
        _type: 'configuracionWhatsApp',
        numeroDefault: '528123207311',
        asignaciones: [],
      });

      const configActual = await client.fetch(
        `*[_id == $id][0]{asignaciones}`,
        { id: CONFIG_WHATSAPP_ID }
      );
      const asignacionesActuales = configActual?.asignaciones || [];
      const yaExiste = asignacionesActuales.some((a: any) => a.departamento === departamentoSlug);

      const nuevasAsignaciones = yaExiste
        ? asignacionesActuales.map((a: any) =>
            a.departamento === departamentoSlug
              ? {
                  ...a,
                  ...(hayNumeroNuevo ? { numero: numeroWhatsApp!.trim() } : {}),
                  ...(hayNombreBonitoNuevo ? { nombreBonito: nombreDepartamento!.trim() } : {}),
                }
              : a
          )
        : [
            ...asignacionesActuales,
            {
              _key: departamentoSlug,
              departamento: departamentoSlug,
              numero: hayNumeroNuevo ? numeroWhatsApp!.trim() : '',
              ...(hayNombreBonitoNuevo ? { nombreBonito: nombreDepartamento!.trim() } : {}),
            },
          ];

      await client.patch(CONFIG_WHATSAPP_ID).set({ asignaciones: nuevasAsignaciones }).commit();
    }

    return new Response(
      JSON.stringify({ ok: true, _id: creada._id, titulo: creada.titulo, departamento: creada.departamento }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
