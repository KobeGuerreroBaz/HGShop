# Carritos · Revisar precios

Sistema para ponerle precio a mis Hot Wheels, Matchbox y Cars de HG Shop MX (hgstoremx.com) usando lo que cobran otros vendedores en sus álbumes de Facebook.

La página **solo muestra referencias**: los precios los decido yo. No usa IA para comparar.

> Para una sesión nueva con Claude: "lee `scripts/precios/LEEME.md`" y con eso tiene el contexto.

---

## Cómo trabajamos (reglas para Claude)

- Antes de cambiar cualquier archivo: explicar **qué** se va a cambiar y **por qué**, y pedir autorización. Leer o revisar no necesita permiso.
- Los deploys, commits y push los hago yo a mano.
- Nunca imprimir secretos (`.env`, `.dev.vars`).
- Si los archivos de `scripts/precios/` están abiertos en un editor (VS Code, por ejemplo) cuando Claude los cambia, hay que recargarlos desde disco o cerrarlos: una versión vieja abierta puede volver a guardarse encima. Antes de hacer commit conviene correr `git diff --stat` y confirmar que los cambios estén completos.

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
| `scripts/precios/revisar.mjs` | Servidor de la página. Lee mis productos de Sanity, compara contra la base, guarda precios, corre álbumes nuevos (con protección por link) y rearma la base sola. También sirve la vista **Por revisar** (lista, decisiones, fotos y capturas). |
| `scripts/precios/revisar.html` | La página: tarjetas, filtros, visor de fotos y la vista **🔍 Por revisar** (tipos de problema, detalles, pie de foto y botones de decisión). |
| `scripts/precios/armar-base.mjs` | Convierte `precios_maestro.json` del scraper en `scripts/salida/base-precios.json` y **aplica mis decisiones de Por revisar** (descartar, corregir, quitar "dudoso"). También arma la lista de filas por revisar. |
| `src/lib/emparejar-precios.mjs` | Motor para emparejar (sin IA): palabras, marca, pesos, sinónimos aprendidos, número (ej. 43/250) y serie. |
| `scripts/precios/precios-carritos.applescript` | Fuente de la app del Dock "Precios Carritos". |
| `~/Desktop/scraper-hotwheels/` | El scraper. Tiene su propio `LEEME.md`. |

### Datos locales — `scripts/salida/` (NO se suben a git: respaldar de vez en cuando)

| Archivo | Contenido |
|---|---|
| `base-precios.json` | La base que usa la página (se regenera, no se edita a mano). |
| `equivalencias.json` | Mis decisiones: ✓ es este / ✗ no es / ≈ otra versión, coincidencias confirmadas o rechazadas y palabras aprendidas. |
| `revision-estado.json` | Precios guardados o saltados, con fecha, y qué álbumes había al guardar (para Novedades). |
| `revision-fotos.json` | Mis decisiones de **Por revisar**: revisada / descartada / corregida, con la fecha y lo que corregí. Se identifica cada fila por `álbum\|foto\|posición`, así que sigue valiendo si vuelvo a correr un álbum. **Respaldar:** no está en git. |
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
- **📚 Álbumes** muestra el historial por vendedor. De cada álbum: fecha, precios, cuántos están por revisar (botón que abre la vista Por revisar de ese álbum), fotos leídas, omitidos y **Abrir en Facebook ↗**.
- El nombre del álbum queda como `vendedor-mesDIA`, por ejemplo `alain-rodriguez-oct25`.
- El recuadro de avance tiene un botón **Copiar log** (funciona también desde el iPhone). Al terminar el álbum, el log lista las filas por revisar con foto, carrito, precio y motivo.

**Protección contra álbumes repetidos (por link):**
- Al pegar el link, la página revisa si ya es de un álbum procesado, comparando el id del álbum (`set=pcb.…`, o el de la foto) contra la primera foto de cada álbum guardado (`debug/<álbum>_foto_001.json`). Avisa en rojo aunque haya escrito otra fecha u otro nombre de vendedor, o pegado otra foto del mismo álbum.
- Si lo proceso de todos modos, pide confirmación y **reemplaza ese mismo álbum con su nombre original** (no crea una copia). Una prueba de 3 fotos no avisa porque no guarda nada.
- Si el nombre coincide pero el link es distinto, avisa que se reemplazaría un álbum diferente (cambiar fecha o vendedor).
- **Desde la terminal no hay esta protección:** `node extraer_album.mjs 0 "<link>" nombre` reemplaza sin avisar. Desde la terminal solo uso pruebas.

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

## 🔍 Por revisar (filas dudosas de todos los álbumes)

Botón fijo arriba (**🔍 Por revisar (N)**, con el conteo de pendientes) y también desde 📚 Álbumes, tocando el "N por revisar" de un álbum. Lista las filas que el scraper marcó como dudosas (`revisar: true` en `precios_maestro.json`) de **todos** los álbumes.

**Qué trae cada fila:** foto (clic = visor grande), modelo, precio, serie, número, álbum · foto · posición, el **pie de foto del vendedor** (ahí van los precios), una etiqueta con el **tipo de problema**, una línea **"Qué revisar"** y la **nota original** de Gemini o del scraper.

**Tipos de problema** (se deciden por las palabras de la nota, así que son una guía; la nota completa siempre se muestra):

| Tipo | Cuándo | Qué hacer |
|---|---|---|
| 💲 Precio por confirmar | Sin precio, pie de foto no leído como texto, lote/combo o precio supuesto | Confirmar con el pie de foto o la captura de Facebook |
| 📵 Foto sin leer | No se leyó la foto o hubo error | Ver Facebook; corregir o descartar |
| 🧮 Faltan carritos | Gemini encontró menos carritos de los esperados | Revisar que no falte otro |
| 🧩 Posible custom, reempaque o set | Notas de custom, bootleg, diorama, set | Descartar si no es comparable |
| 🔤 Nombre dudoso | Modelo estimado, no legible, "verificar nombre" | Comparar con el empaque; corregir |
| ❔ Gemini no explicó | Solo "Marcado por Gemini", sin motivo | Revisar nombre, precio y posición |
| 📝 Nota de Gemini | Una observación sin duda clara | ✓ Está bien si nombre y precio coinciden |

**Filtros:** álbum, tipo de problema (con cuántas pendientes hay de cada uno), Pendientes / Ya resueltas, y el interruptor **"Mostrar las de $30 o menos"** (ocultas por defecto: la base ya las ignora y no cuentan en los números).

**Decisiones por fila:**

| Botón | Efecto |
|---|---|
| ✓ Está bien | Revisada: se quita la etiqueta "dudoso" y sale de la lista. |
| ✎ Corregir | Cambio modelo, serie, número y precio. La fila queda revisada y **entra a la base** con lo corregido (sin precio no entra). |
| 🗑 Descartar | La fila no entra a la base. No se borra del maestro; se deshace con ↺. |
| ↺ Deshacer | Quita la decisión (se ve en "Ya resueltas"). |

Las decisiones se guardan en `scripts/salida/revision-fotos.json` y se **aplican a la base al cerrar la ventana** ("Cerrar y aplicar"); la página se recarga sola. Si vuelvo a correr un álbum y Gemini cambia la posición de un carrito, esa decisión ya no coincide y la fila vuelve a salir pendiente.

**Visor en modo Por revisar** (clic en la foto de una fila): foto grande con zoom, panel de **detalles** (con pie de foto, tipo y qué revisar), cuadro amarillo de **posición** en fotos con varios carritos, flechas ← → entre las filas del filtro actual y botón **Facebook ↗**. Si el scraper guardó una captura de Facebook (81 fotos, las de pie no legible), el botón **Ver captura de Facebook** alterna entre la foto y la captura.

| Tecla (visor en Por revisar) | Acción |
|---|---|
| S | ✓ Está bien (pasa a la siguiente) |
| N | 🗑 Descartar (pasa a la siguiente) |
| E | ✎ Corregir (cierra el visor y abre el formulario de esa fila) |
| C | Alternar foto / captura de Facebook |
| R | Resaltar la posición sí/no |
| ← → | Anterior / siguiente |
| Esc | Cerrar |

---

## Cómo funcionan las llaves y el saldo (resumen)

Hay dos llaves de Gemini (scraper y tienda) del mismo proyecto "tienda hg": comparten un solo saldo prepagado. Detalles de costos y candados en `~/Desktop/scraper-hotwheels/LEEME.md`. En el sitio se **quitó** la referencia de precio con IA (commit df8a15c); la referencia de precios sale solo de esta página.

## Reglas de datos

- **Marcas:** solo Hot Wheels (incluye Premium, Racerverse, Mario Kart y Monster Trucks), Matchbox y Cars. Nada de carritos sueltos ni otras marcas.
- **Precio mínimo:** los de **$30 o menos se ignoran**, para todos los vendedores. Los "$20 c/u" son fantasía.
- **Identificar un carrito:** **nombre + número (ej. 43/250) + serie.**
- **Tarjetas especiales** (temáticas, de tienda, Premium, ZAMAC, Target, etc.) valen más y se marcan con ★.

## Vendedores

| Vendedor | Estado |
|---|---|
| Mario Lopez | Álbumes sep07, sep14, sep21, sep28, oct05, oct15, oct20. Fotos chicas (720 px): sin números de colección. |
| Alain Rodriguez | Álbumes sep13, sep20, oct25, ago10, oct18. Es el que más me gusta como referencia; fotos grandes, con números de colección. |
| Fernando Huerta | Pendiente: falta el link. |
| Anny | A futuro. |
| Joanna | Descartada; sus datos se borraron. |

Estado al 29 oct 2026: 12 álbumes, 3,977 filas en la base del scraper; la base de la página tiene ~2,322 precios (lo de $30 o menos se deja fuera). Por revisar: 222 filas en total, 121 relevantes (101 son de $30 o menos).

---

## Pendientes

- [ ] Resolver las filas de **Por revisar**: empezar por las de 💲 Precio por confirmar (≈26).
- [ ] Álbum de Fernando Huerta y más álbumes de Alain (cada álbum de 50-80 fotos cuesta ~1-7 MXN; el scraper tiene tope de 8 MXN por corrida).
- [ ] Respaldar `scripts/salida/` de vez en cuando (incluye `equivalencias.json`, `revision-estado.json` y `revision-fotos.json`: son mis decisiones y no están en git).
- [ ] Deploy después de guardar precios nuevos (solo si cambió algo en Sanity).

## Ideas en espera (solo si las pido)

- Poner el precio desde el visor.
- Botón "siguiente carrito".
- Más datos en la barra del visor.
- Deslizar con el dedo en el iPhone.
- Ajustar los umbrales del buscador.
- Botón para ir a /inventario.
