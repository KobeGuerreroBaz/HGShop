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
      validation: (Rule) => Rule.required().positive(),
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
      name: 'imagenPrincipal',
      title: 'Imagen principal',
      type: 'image',
      options: { hotspot: true },
      validation: (Rule) => Rule.required(),
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
  ],
});
