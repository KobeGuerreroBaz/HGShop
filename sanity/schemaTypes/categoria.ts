import { defineField, defineType } from 'sanity';

export default defineType({
  name: 'categoria',
  title: 'Categoría',
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
  name: 'departamento',
  title: 'Departamento',
  type: 'string',
  options: {
    list: ['bebes', 'herramientas', 'bath-body', 'perfumes', 'juguetes'],
  },
  validation: (Rule) => Rule.required(),
}),

    defineField({
      name: 'imagen',
      title: 'Imagen',
      type: 'image',
      options: { hotspot: true },
      validation: (Rule) => Rule.required(),
    }),
  ],
});
