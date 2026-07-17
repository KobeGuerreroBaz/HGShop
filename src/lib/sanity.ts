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
