import { defineField, defineType } from 'sanity';

export default defineType({
  name: 'configuracionWhatsApp',
  title: 'Configuración de WhatsApp',
  type: 'document',
  fields: [
    defineField({
      name: 'numeroDefault',
      title: 'Número por default (Humberto)',
      type: 'string',
      initialValue: '528123207311',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'asignaciones',
      title: 'Asignaciones por departamento',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'departamento', title: 'Departamento', type: 'string' }),
            defineField({ name: 'numero', title: 'Número de WhatsApp', type: 'string' }),
            defineField({
              name: 'nombreBonito',
              title: 'Nombre para mostrar (SEO/UI)',
              type: 'string',
              description: 'Nombre legible del departamento, ej. "Bath and Body" en vez de "bath-body". Se usa en títulos, menús y migajas de pan.',
            }),
          ],
        },
      ],
    }),
  ],
});
