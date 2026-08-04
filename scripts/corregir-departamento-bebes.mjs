import { createClient } from '@sanity/client';
import 'dotenv/config';

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

async function main() {
  console.log('Buscando categorías con departamento "Bebes" (mayúscula)...');

  const categoriasAfectadas = await client.fetch(
    `*[_type == "categoria" && departamento == "Bebes"]{_id, titulo, departamento}`
  );

  if (categoriasAfectadas.length === 0) {
    console.log('No se encontró ninguna categoría con departamento "Bebes". Nada que corregir.');
    return;
  }

  console.log(`Se encontraron ${categoriasAfectadas.length} categoría(s):`);
  categoriasAfectadas.forEach((cat) => console.log(`  - ${cat.titulo} (${cat._id})`));

  for (const cat of categoriasAfectadas) {
    await client.patch(cat._id).set({ departamento: 'bebes' }).commit();
    console.log(`✔ Corregida: ${cat.titulo}`);
  }

  console.log('\nRevisando si "configuracionWhatsApp" tiene una asignación para "Bebes"...');
  const config = await client.fetch(
    `*[_id == "configuracionWhatsApp"][0]{asignaciones}`
  );

  if (config?.asignaciones?.some((a) => a.departamento === 'Bebes')) {
    const nuevasAsignaciones = config.asignaciones.map((a) =>
      a.departamento === 'Bebes' ? { ...a, departamento: 'bebes' } : a
    );
    await client.patch('configuracionWhatsApp').set({ asignaciones: nuevasAsignaciones }).commit();
    console.log('✔ Asignación de WhatsApp corregida también.');
  } else {
    console.log('No había ninguna asignación de WhatsApp con "Bebes". Nada que tocar ahí.');
  }

  console.log('\n¡Listo! Todo unificado bajo "bebes" (minúscula).');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
