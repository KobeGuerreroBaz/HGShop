# Carritos · Revisar precios

Sistema para ponerle precio a mis Hot Wheels, Matchbox y Cars de HG Shop MX (hgstoremx.com) usando lo que cobran otros vendedores en sus álbumes de Facebook.

La página **solo muestra referencias**: los precios los decido yo. No usa IA para comparar.

> Para una sesión nueva con Claude: "lee `scripts/precios/LEEME.md`" y con eso tiene el contexto.

---

## Cómo trabajamos (reglas para Claude)

- Antes de cambiar cualquier archivo: explicar **qué** se va a cambiar y **por qué**, y pedir autorización. Leer o revisar no necesita permiso.
- Los deploys, commits y push los hago yo a mano.
- Nunca imprimir secretos (`.env`, `.dev.vars`).

---

## Las piezas

```
Facebook (álbumes de vendedores)
   │  ~/Desktop/scraper-hotwheels/extraer_album.mjs   (Playwright + OCR + Gemini)
   ▼
precios_maestro.json  (base acumulada de todos los álbumes)
   │  scripts/precios/armar-base.mjs
   ▼
scripts/salida/base-precios.json
   │  scripts/precios/revisar.mjs  (servidor, puerto 4400)
   ▼
Página "Carritos · Revisar precios"  ──Guardar precio──▶  Sanity (solo el campo "precio")
                                                          ▼
                                                 deploy ▶ hgstoremx.com
```

| Archivo | Qué hace |
|---|---|
| `scripts/precios/revisar.mjs` | Servidor de la página. Lee mis productos de Sanity, compara contra la base, guarda precios, corre álbumes nuevos y rearma la base sola. |
| `scripts/precios/revisar.html` | La página: tarjetas, filtros y visor de fotos. |
| `scripts/precios/armar-base.mjs` | Convierte `precios_maestro.json` del scraper en `scripts/salida/base-precios.json`. |
| `src/lib/emparejar-precios.mjs` | Motor para emparejar (sin IA): palabras, marca, pesos, sinónimos aprendidos, número (ej. 43/250) y serie. |
| `scripts/precios/precios-carritos.applescript` | Fuente de la app del Dock "Precios Carritos". |
| `~/Desktop/scraper-hotwheels/` | El scraper. Tiene su propio `LEEME.md`. |

### Datos locales — `scripts/salida/` (NO se suben a git: respaldar de vez en cuando)

| Archivo | Contenido |
|---|---|
| `base-precios.json` | La base que usa la página (se regenera, no se edita a mano). |
| `equivalencias.json` | Mis decisiones: ✓ es este / ✗ no es / ≈ otra versión, coincidencias confirmadas o rechazadas y palabras aprendidas. |
| `revision-estado.json` | Precios guardados o saltados, con fecha, y qué álbumes había al guardar (para Novedades). |
| `vendedores.json` | Vendedores dados de alta aunque todavía no tengan álbum. |
| `pagina.log` | Lo que imprime el servidor cuando se abre con la app. |

---

## Uso diario

**Abrir:** app **"Precios Carritos"** del Dock (está en `~/Applications`), o en la terminal:

```
cd ~/Developer/hgshop && node scripts/precios/revisar.mjs
```

Se abre en `http://localhost:4400`.

- **Desde el iPhone:** misma red Wi-Fi, con la dirección que muestra la página. Pide PIN.
- **Apagar:** botón **⏻ Apagar**. Si solo cierro la pestaña, el servidor sigue prendido por detrás.
- **Todo se guarda al momento.** No hay que darle a nada para guardar.
- **Los precios que guardo** van a Sanity, pero se ven en el sitio hasta que hago **deploy**.

**Si cambio el código del servidor (`revisar.mjs`)**, hay que apagar y volver a abrir. Para cambios solo en `revisar.html`, basta con recargar la página.

**Rearmar la base a mano** (normalmente no hace falta, porque al correr un álbum desde la página se rearma sola):

```
cd ~/Developer/hgshop && node scripts/precios/armar-base.mjs
```

Después de rearmarla, apagar y volver a abrir la página.

### Agregar un álbum nuevo

Botón **➕ Agregar álbum** → link del álbum, vendedor y fecha → corre el scraper y muestra el avance.

- Si Facebook pide iniciar sesión, la página espera; inicio sesión y le doy continuar.
- **📚 Álbumes** muestra el historial por vendedor.
- El nombre del álbum queda como `vendedor-mesDIA`, por ejemplo `alain-rodriguez-oct25`.

---

## La página

### Filtros

| Filtro | Muestra |
|---|---|
| Pendientes | Lo que no he revisado. |
| 🔔 Novedades | Carritos que ya preciaron y tienen precios nuevos de álbumes corridos después. |
| Sin precio | Pendientes sin precio. |
| Mi precio debajo / arriba de la base | Pendientes donde mi precio queda fuera del rango de referencia. |
| Sin coincidencia | No se encontró en la base. Se puede buscar con otro nombre. |
| ⭐ Cotizados | Modelos que me han pedido. |
| Ya revisados / Todos | Lo que su nombre dice. |

### Tarjeta de cada carrito

- **Izquierda:** mi carrito, mi precio y etiquetas (sin precio, guardado, arriba o debajo de la base, 🔔 precios nuevos).
- **Derecha:** coincidencias de la base, cada una con sus fotos (avistamientos). Por cada foto:
  - **✓** — es mi carrito. Cuenta para el rango y el buscador aprende el nombre.
  - **≈** — **otra versión**: mismo carrito de otro color o año.
    - Su precio sale aparte ("≈ Otra versión: $50–$60 (2)").
    - No cuenta para el rango ni enseña nada al buscador.
  - **✗** — no es. La foto se oculta para ese carrito.
  - **↺** — deshace la decisión.
- **Abajo:** precio, **Guardar precio**, **Saltar** o **Marcar pendiente**, y **Visto** (solo cuando hay novedades).

**Para corregir un precio equivocado:** lo busco en "Ya revisados", cambio el número y le doy **Guardar precio** otra vez.

### Rango de referencia

1. Si hay fotos que marqué con ✓, el rango sale de esas.
2. Si no hay, sale de las que tienen el mismo número que mi carrito.
3. Si tampoco hay, sale de la coincidencia confirmada o de la mejor con 70% o más.

Las de "otra versión" nunca entran en el rango.

### 🔔 Novedades

- Al guardar un precio se anota qué álbumes existían en ese momento.
- Si después corro un álbum y aparecen precios nuevos de ese carrito, sale en Novedades:
  - con el aviso **"Tú: $80 · nuevos: $60 → estás arriba / abajo / dentro"**,
  - y con las fotos nuevas marcadas con la etiqueta **"nuevo"** y orilla naranja.
- Solo cuentan coincidencias confiables: las confirmadas, las del mismo número o las de 70% o más. No cuentan las que marqué ✗ ni ≈.
- **Visto** lo quita de la lista dejando mi precio igual. Volver a guardar el precio también lo quita.

### Visor (foto en grande)

- **Barra de arriba:** "Tu carrito: …".
- **Mi foto al lado:** en Mac ocupa ¼ de la pantalla; en iPhone sale como franja arriba. El botón "Ocultar mi carrito" la quita.
- **Teclas:**

| Tecla | Acción |
|---|---|
| S | ✓ Es este |
| N | ✗ No es (oculta la foto y pasa a la siguiente) |
| V | ≈ Otra versión |
| R | Resaltar sí/no |
| ← → | Anterior / siguiente |
| 0 | Ajustar |
| Esc | Cerrar |

- **Resaltar posición:** cuadro amarillo "pos. N" calculado con una cuadrícula según cuántos carritos trae la foto.
  - Es una estimación: puede fallar si el vendedor acomoda en desorden.
  - Necesita `totalFoto` en la base. Si no aparece, rearmar la base.
- **iPhone:** pellizcar para hacer zoom, doble toque para acercar o ajustar.
- **Mensajes:** con el visor abierto no salen avisos; solo los errores, y salen arriba.

---

## Reglas de datos

- **Marcas:** solo Hot Wheels (incluye Premium, Racerverse, Mario Kart y Monster Trucks), Matchbox y Cars. Nada de carritos sueltos ni otras marcas.
- **Precio mínimo:** los de **$30 o menos se ignoran**, para todos los vendedores. Los "$20 c/u" son fantasía.
- **Identificar un carrito:** **nombre + número (ej. 43/250) + serie.**
- **Tarjetas especiales** (temáticas, de tienda, Premium, ZAMAC, Target, etc.) valen más y se marcan con ★.

## Vendedores

| Vendedor | Estado |
|---|---|
| Mario Lopez | Álbumes sep07, sep14, sep21, sep28, oct05, oct15, oct20. |
| Alain Rodriguez | oct25. Es el que más me gusta como referencia. |
| Fernando Huerta | Pendiente: falta el link. |
| Anny | A futuro. |
| Joanna | Descartada; sus datos se borraron. |

---

## Pendientes

- [ ] Deploy de los precios guardados.
- [ ] Commit y push de los cambios de `scripts/precios/` y `src/lib/emparejar-precios.mjs`.
- [ ] Álbum de Fernando Huerta y más álbumes de Alain.
- [ ] Respaldar `scripts/salida/` de vez en cuando.

## Ideas en espera (solo si las pido)

- Poner el precio desde el visor.
- Botón "siguiente carrito".
- Más datos en la barra del visor.
- Deslizar con el dedo en el iPhone.
- Ajustar los umbrales del buscador.
- Botón para ir a /inventario.
