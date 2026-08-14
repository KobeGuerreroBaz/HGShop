import { createClient } from '@sanity/client';
import imageUrlBuilder from '@sanity/image-url';

export const sanityClient = createClient({
  projectId: 'lit3j3pr',
  dataset: 'production',
  apiVersion: '2024-01-01',
  useCdn: true, // true = respuestas más rápidas, ideal para un sitio que no cambia a cada rato
});

const builder = imageUrlBuilder(sanityClient);

export function urlFor(source: any) {
  return builder.image(source);
}

// Número de WhatsApp de Humberto: se usa cuando configuracionWhatsApp no tiene
// numeroDefault en Sanity (documento aún no creado) o no hay asignación para el
// departamento. Vive en un solo lugar para no desincronizarse entre archivos.
export const NUMERO_WHATSAPP_DEFAULT = '528123207311';

interface AsignacionWhatsApp {
  departamento: string;
  numero: string;
  nombreBonito?: string;
}

interface ConfiguracionWhatsApp {
  numeroDefault: string;
  asignaciones: AsignacionWhatsApp[];
}

export async function obtenerConfiguracionWhatsApp(): Promise<ConfiguracionWhatsApp> {
  const config = await sanityClient.fetch(`
    *[_type == "configuracionWhatsApp"][0]{
      numeroDefault,
      asignaciones
    }
  `);

  return {
    numeroDefault: config?.numeroDefault || NUMERO_WHATSAPP_DEFAULT,
    asignaciones: config?.asignaciones || [],
  };
}

export function numeroWhatsAppParaDepartamento(
  departamento: string,
  config: { numeroDefault: string; asignaciones: { departamento: string; numero: string }[] }
) {
  const asignacion = config.asignaciones.find((a) => a.departamento === departamento);
  return asignacion?.numero || config.numeroDefault;
}

const NOMBRES_BONITOS: Record<string, string> = {
  'bath-body': 'Bath and Body',
  'bebes': 'Bebés',
  'autos-a-escala': 'Autos a Escala',
  'cars': 'Cars',
  'green-light': 'Greenlight',
  'herramientas': 'Herramientas',
  'hot-wheels': 'Hot Wheels',
  'juguetes': 'Juguetes',
  'm2': 'M2 Machines',
  'mochilas': 'Mochilas',
  'ninos': 'Niños',
  'pokemon-tcg': 'Pokémon TCG',
  'termos-y-vasos': 'Termos y Vasos',
  'victoria-s-secret': "Victoria's Secret",
};

function formatearSlugAutomaticamente(departamento: string): string {
  return departamento
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letra) => letra.toUpperCase());
}

export function nombreDepartamento(
  departamento: string,
  config?: { asignaciones: AsignacionWhatsApp[] }
): string {
  const nombreDesdeSanity = config?.asignaciones.find((a) => a.departamento === departamento)?.nombreBonito;
  if (nombreDesdeSanity) return nombreDesdeSanity;

  return NOMBRES_BONITOS[departamento] || formatearSlugAutomaticamente(departamento);
}
