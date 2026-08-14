export const prerender = false;
import type { APIRoute } from 'astro';
import { NUMERO_WHATSAPP_DEFAULT } from '../../lib/sanity';
import { jsonError, jsonOk, sanityClientEscritura, verificarAcceso } from '../../lib/api-utils';

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
  const bloqueo = await verificarAcceso(request, 'crear-categoria');
  if (bloqueo) return bloqueo;

  try {
    const { titulo, departamento, numeroWhatsApp, nombreDepartamento } = await request.json() as {
      titulo: string;
      departamento: string;
      numeroWhatsApp?: string;
      nombreDepartamento?: string;
    };

    if (!titulo || !titulo.trim()) {
      return jsonError('El titulo de la categoria es requerido');
    }
    if (!departamento || !departamento.trim()) {
      return jsonError('El departamento es requerido');
    }

    const client = sanityClientEscritura();

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
        numeroDefault: NUMERO_WHATSAPP_DEFAULT,
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

    return jsonOk({ ok: true, _id: creada._id, titulo: creada.titulo, departamento: creada.departamento });
  } catch (error: any) {
    return jsonError(error.message, 500);
  }
};
