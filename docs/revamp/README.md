# Revamp de la interfaz

Implementación del paquete `biker-4x-revamp` (brief, boceto y atlas). Fuente de verdad: el código, `data/` y `docs/GDD.md`; el boceto (`assets/ui/source/referencia-ui.png`) es solo dirección visual.

## Qué cambió

| Área | Antes | Ahora |
|---|---|---|
| Navegación | Pestañas en una barra lateral (Club, Mesa, Negocios, Zona, Informe) | **Condado · Club · Mesa · Negocios · Informe**, con título de sección. Distrito = `Condado › Distrito`, con botón de regreso |
| Cabecera | Una línea de textos | Bloques con etiqueta: semana, plata, zonas con barra de progreso y racha, lealtad, sheriff, federales (`?` si están ocultos), relaciones. «Revisar semana» y menú «Opciones» |
| Condado | Mapa + pestaña Zona | Mapa a la izquierda e **inspector** a la derecha: dueño, calor, policía, riqueza, lotes, control por facción, negocios, vecinas, tareas planeadas, miembros (enlace a Club), meta del condado y acceso a la sede |
| Distrito | Panel de lote con botones | Inspector del lote: negocio con ilustración, dueño y estado; opciones de construcción con costo real y motivo concreto del bloqueo («te faltan $X») |
| Club | Tabla angosta | Tabla ancha: retrato, rango y rasgo, estado con semanas de vuelta, stats, lealtad con barra, tarea + destino (lista o «Mapa»). Aviso si la tarea no rendiría (sin stock, sin negocio). Tarjeta de la **Sede** |
| Mesa | Lista vertical | Tres columnas: cola de propuestas (con costo si se aprueba y errores), formulario + detalle, probabilidades con retrato y rango |
| Negocios | Listas | **Cadenas** (Motos · Marihuana · Cocaína · Armas) con nodos ilustrados y flechas SVG, panel de detalle con las acciones de siempre (vender, comprar al cartel, proponer), tabla de negocios, stock y precios, **lavado** con rango y campo sincronizados, construcción legal, órdenes en cola |
| Informe | Secciones por etapa | Igual, con índice de etapas y enlace al distrito en los combates |
| Avanzar | «Avanzar semana» / Enter | **Revisar semana** (Enter) → resumen → «Resolver semana» (una sola vez) |

## Arquitectura

- `src/ui/app.ts`: controlador (estado de partida + estado de interfaz, acciones, render). El renderer del mapa se crea una vez y solo se oculta.
- `src/ui/uiState.ts`: estado de navegación y borradores, separado de `GameState` (no se guarda con la partida). Funciones puras de navegación.
- `src/ui/panels/`: `header`, `county` (mapa, leyenda, inspector, lote), `club`, `council`, `business`, `report`, `modals` (revisión, sede, ficha, nueva partida, ayuda, final).
- Modelos puros con tests: `src/ui/productionChains.ts` (cadenas), `src/ui/review.ts` (revisión de la semana), y en `src/ui/viewModel.ts`: `hqSheet`, `launderingPanel`, filas de negocios ampliadas, votos con id del votante.
- `src/ui/assets.ts`: catálogo de ilustraciones (URLs de Vite, sirven en dev, build y Tauri) con *fallback* al glifo.

No se tocó `src/sim`, `assets/tiles/`, `data/ui.json` ni los algoritmos de mapa. Única línea nueva en `src/render/map.ts`: un gancho **solo de desarrollo** (`window.__mapSnapshot`) para comparar píxeles.

## Verificación

- `npm run typecheck`, `npm run lint`, `npm test` (395 tests, 33 nuevos en `tests/revamp.test.ts`), `npm run build`: pasan.
- **Mapa idéntico:** con la partida `tests/fixtures/save-v0.2.0.json`, escala 1, se comparó el hash de la imagen extraída del escenario de Pixi antes y después: condado (tiles y ASCII) y distrito Redwater (tiles y ASCII) dan exactamente lo mismo.
- **Turno completo en el navegador:** tareas, destino elegido en el mapa, navegación sin perder órdenes, revisión, resolución (tres clics seguidos resuelven una sola semana), informe, cargar partida, nueva partida con parche, ayuda, Escape.
- **Capturas** (`docs/revamp/capturas/`, con `node scripts/capture-ui.mjs`): 1920×1080 todas las vistas; 1366×768, 1024×768 y 768 px las principales. Sin errores de JS, sin cargas fallidas y sin desborde horizontal, también contra el build de producción (`vite preview`).
- La partida de revisión `tests/fixtures/review-economy.json` se armó con la simulación (club con varios distritos, negocios de cada cadena, stock y trato con el cartel) y dos semanas jugadas por el motor.

## Ilustraciones

Ver `assets/ui/README.md`: 16 recortes del atlas sin re-escalar en lienzos de 252×252, mostrados a 63/84/126 px con `image-rendering: pixelated`. A 84 px se ven nítidos con vecino más cercano (se comparó contra Lanczos). Son generadas con IA, no llevan la licencia de Kenney.

## Decisiones y límites

- **Robar motos y Venta** no venían en el atlas: se dibujaron con código en el mismo estilo (`scripts/draw-ui-illustrations.py`, registradas en `assets/ui/illustrations-extra.json`). Robar motos: rueda encadenada con la cadena cortada, candado abierto y cizalla. Venta: bolsa de plata, fajos y monedas.
- **Escala del mapa:** el renderer elige escala entera por ancho. A 1920×1080 el mapa queda a ×2 (1600×1024) y la columna del mapa se desplaza verticalmente; no se tocó la lógica de escala.
- **Inspector y destino por mapa:** «Mapa» en Club abre el Condado con un aviso; si estabas dentro de un distrito, se mantiene (el brief pide no perderlo) y hay que volver al condado para elegir otro distrito.
- **Federales ocultos:** la cabecera muestra `?` y el valor no llega al DOM; el aviso de lavado habla de «la investigación federal sube», sin cifras.
- **Escritorio:** no hay Rust en esta Mac, así que el instalador no se compiló localmente; el build web de producción (el mismo que empaqueta Tauri) carga todos los assets. El workflow de Windows se puede correr a mano sobre la rama.
- Las reglas de ayuda que ya tenían números escritos («12 de las 18 zonas», «35 de lealtad») se dejaron como estaban.
