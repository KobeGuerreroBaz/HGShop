// Dibuja el recuadro "Referencia de precio" en /subir e /inventario.
// Todo con textContent/elementos (nunca innerHTML con datos externos).
import type { ReferenciaPrecio } from './tipos';
// @ts-ignore - módulo JS compartido
import { ETIQUETAS_TIPO_PRECIO, FLUJOS_PRECIO } from './flujos-precio.mjs';

const formatoPesos = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
// Siempre "US$" para que nunca se confunda con pesos.
const formatoDolares = { format: (n: number) => `US$${n.toFixed(2)}` };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, clases: string, texto?: string) {
  const nodo = document.createElement(tag);
  nodo.className = clases;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

export function mostrarCargandoPrecio(contenedor: HTMLElement) {
  contenedor.innerHTML = '';
  contenedor.className = 'rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600';
  contenedor.textContent = 'Buscando referencia de precio en internet…';
  contenedor.classList.remove('hidden');
}

export function mostrarErrorPrecio(contenedor: HTMLElement, mensaje: string) {
  contenedor.innerHTML = '';
  contenedor.className = 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800';
  contenedor.textContent = `No se pudo buscar el precio: ${mensaje}`;
  contenedor.classList.remove('hidden');
}

export function pintarReferenciaPrecio(contenedor: HTMLElement, ref: ReferenciaPrecio) {
  contenedor.innerHTML = '';
  contenedor.className = 'rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950 space-y-2';
  contenedor.classList.remove('hidden');

  const encabezado = el('p', 'font-semibold');
  encabezado.textContent = `Referencia de precio · ${FLUJOS_PRECIO[ref.flujo] || ''} · ${ref.fecha}`;
  contenedor.appendChild(encabezado);

  if (ref.alertaValor) {
    contenedor.appendChild(
      el('p', 'rounded bg-amber-100 border border-amber-300 text-amber-900 px-2 py-1 font-medium', `⚠️ ${ref.alertaValor}`)
    );
  }

  if (ref.precios.length === 0) {
    contenedor.appendChild(el('p', '', 'No se encontraron precios confiables con las reglas de este tipo de producto.'));
  } else {
    const lista = el('ul', 'space-y-1');
    for (const p of ref.precios) {
      const fila = el('li', 'flex items-baseline justify-between gap-3 border-b border-sky-100 pb-1');
      const izquierda = el('span', 'min-w-0 break-words');
      if (p.url) {
        const enlace = el('a', 'underline', p.tienda) as HTMLAnchorElement;
        enlace.href = p.url;
        enlace.target = '_blank';
        enlace.rel = 'noopener noreferrer';
        izquierda.appendChild(enlace);
      } else {
        izquierda.appendChild(document.createTextNode(p.tienda));
      }
      const etiqueta = ETIQUETAS_TIPO_PRECIO[p.tipo] || p.tipo;
      izquierda.appendChild(el('span', 'text-sky-800/70', ` · ${etiqueta}${p.detalle ? ` · ${p.detalle}` : ''}`));

      const precio =
        p.moneda === 'USD'
          ? `${formatoDolares.format(p.precio)}${p.mxn ? ` ≈ ${formatoPesos.format(p.mxn)}` : ''}`
          : formatoPesos.format(p.precio);
      fila.append(izquierda, el('span', 'shrink-0 font-semibold text-right', precio));
      lista.appendChild(fila);
    }
    contenedor.appendChild(lista);
  }

  if (ref.nota) contenedor.appendChild(el('p', 'italic text-sky-900/80', ref.nota));
  const pie = [
    ref.productoBuscado ? `Buscado: ${ref.productoBuscado}` : '',
    ref.tipoCambio ? `Tipo de cambio: $${ref.tipoCambio.toFixed(2)} por dólar` : '',
    'Verifica en el link antes de decidir.',
  ].filter(Boolean).join(' · ');
  contenedor.appendChild(el('p', 'text-[11px] text-sky-900/60', pie));
}
