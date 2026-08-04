import { defineField, defineType } from 'sanity';

export default defineType({
  name: 'producto',
  title: 'Producto',
  type: 'document',
  fields: [
    defineField({
      name: 'titulo',
      title: 'Título',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'titulo' },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'precio',
      title: 'Precio',
      type: 'number',
      validation: (Rule) => Rule.positive(),
    }),
    defineField({
      name: 'cantidadDisponible',
      title: 'Cantidad disponible (control interno, no se muestra al cliente)',
      type: 'number',
      validation: (Rule) => Rule.min(0),
    }),
    defineField({
      name: 'estado',
      title: 'Estado',
      type: 'string',
      options: { list: ['Nuevo', 'Sellado', 'Usado'] },
      initialValue: 'Nuevo',
    }),
    defineField({
      name: 'descripcion',
      title: 'Descripción',
      type: 'text',
    }),
    defineField({
      name: 'altTexto',
      title: 'Texto alternativo de la imagen (SEO/accesibilidad)',
      type: 'string',
      description: 'Descripción breve de lo que se ve en la foto, generada por IA al subir el producto. Se usa como atributo "alt" en todas las imágenes de este producto. Editable si quieres ajustarla.',
    }),
    defineField({
      name: 'imagenPrincipal',
      title: 'Imagen principal',
      type: 'image',
      options: { hotspot: true },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'galeria',
      title: 'Galería (fotos adicionales)',
      type: 'array',
      of: [{ type: 'image', options: { hotspot: true } }],
    }),
    defineField({
      name: 'categoria',
      title: 'Categoría',
      type: 'reference',
      to: [{ type: 'categoria' }],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'palabrasClave',
      title: 'Palabras clave',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Para búsqueda interna y SEO (ej. biberon, mamila, avent)',
    }),
    defineField({
      name: 'capacidad',
      title: 'Capacidad',
      type: 'string',
      description: 'Opcional, ej. 24oz, 260ml',
    }),
    defineField({
      name: 'edicion',
      title: 'Edición',
      type: 'string',
      description: 'Opcional, ej. colección especial',
    }),
    defineField({
      name: 'edadRecomendada',
      title: 'Edad recomendada',
      type: 'string',
      description: 'Opcional, para productos de bebé',
    }),
    defineField({
      name: 'marca',
      title: 'Marca',
      type: 'string',
    }),
    defineField({
      name: 'hashFoto',
      title: 'Hash de la foto (control interno anti-duplicados)',
      type: 'string',
      hidden: true,
    }),
    defineField({
      name: 'mostrarExistencias',
      title: '¿Mostrar existencias al público?',
      type: 'boolean',
      initialValue: false,
      description: 'Si está activado, se muestra un indicador genérico de disponibilidad en la página del producto (sin número exacto).',
    }),
    defineField({
      name: 'agotado',
      title: '¿Agotado?',
      type: 'boolean',
      initialValue: false,
      description: 'Si está activado, el producto se muestra en el sitio como AGOTADO: no se puede agregar al carrito ni pedir por WhatsApp.',
    }),
  ],
  preview: {
    select: {
      title: 'titulo',
      precio: 'precio',
      cantidad: 'cantidadDisponible',
      agotado: 'agotado',
      media: 'imagenPrincipal',
    },
    prepare({ title, precio, cantidad, agotado, media }) {
      const precioTexto = precio ? `$${precio} MXN` : '⚠️ SIN PRECIO';
      const cantidadTexto = cantidad !== undefined ? cantidad : '⚠️ SIN CANTIDAD';
      const prefijoAgotado = agotado ? '🚫 AGOTADO · ' : '';
      return {
        title,
        subtitle: `${prefijoAgotado}${precioTexto} · Stock: ${cantidadTexto}`,
        media,
      };
    },
  },
});
