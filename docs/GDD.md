# GDD — Biker 4X (nombre provisorio)

> Documento de diseño del prototipo. Es la fuente de verdad de las reglas del juego.
> Todos los números son **valores iniciales de balance**: viven en `data/*.json`, no en el código.

---

## 1. Visión

Un 4X por turnos semanales donde dirigís un club de motoqueros en un condado ficticio.
Ganás territorio, armás negocios legales e ilegales, lavás plata, manejás la política
interna del club y esquivás a la ley. Inspiración: *Gangsters*, *City of Gangsters*.
Estética: sprites low-res tipo *Moonring* / *Caves of Qud*. Sin sonido.

**Pitch:** "Sos el presidente. La mesa vota, la calle cobra, el sheriff mira para otro lado… hasta que deja de hacerlo."

## 2. Pilares de diseño

1. **El club es un organismo político.** No das órdenes a unidades: convencés a personas con lealtad propia.
2. **Toda plata tiene un costo.** Lo ilegal paga más, pero genera calor y riesgo.
3. **El territorio es económico, no solo militar.** Una zona vale por lo que produce y lo que permite lavar.
4. **Decisiones legibles.** Cada resultado se explica con un reporte en texto. Nada de cajas negras.

## 3. Ambientación (toda original)

- **Condado de Ash Valley**, zona rural y costera, ficticia, estilo oeste de EE.UU.
- **Tu club:** *Iron Saints MC*, sede en el pueblo de Redwater (nombre editable al empezar).
  - **Fase 11:** al fundar el club se elige el nombre y uno de **50 parches**. Cada parche es pixel art de 16×16: una forma (círculo, rombo, escudo, cuadrado u octógono), un emblema de 10×10 (calavera, alas, lobo, llama, pica, cruz de hierro, rueda, estrella, daga, corona, rayo, ancla, pistones, "1%", ojo o serpiente) y una paleta. Están en `data/patches.json`. Los rivales también tienen parche (los Grim Wolves llevan el lobo de sangre). El parche se ve en la barra superior, en la pestaña del club y, en el mapa, sobre cada distrito que el club controla.
- **Rivales:**
  - *Grim Wolves MC*: club rival, agresivo y territorial.
  - *Cartel Valdés*: proveedor de armas. Puede ser socio o enemigo.
- **La ley:** Oficina del Sheriff de Ash Valley (local, sobornable) y los federales (no sobornables y lentos, pero letales).

## 4. Estructura del turno (1 turno = 1 semana)

1. **Informe:** eventos de la semana anterior, reportes de tareas, cambios de calor y relaciones.
2. **Mesa:** si hay propuestas pendientes (tuyas o de miembros), se votan.
3. **Asignación:** cada miembro activo recibe **una** tarea.
4. **Gestión:** construir o comprar negocios, mover stock, pagar sobornos, fijar cuánto lavar.
5. **Resolución:** la simulación resuelve todo en este orden fijo:
   producción → transporte → ventas → tareas de facciones (jugador + IA, por iniciativa) → combates → lavado → gastos → calor y ley → lealtad → eventos.
6. **Fin de turno:** chequeo de victoria y derrota, guardado automático.

El orden de resolución es parte del diseño. Cambiarlo requiere actualizar este documento.

**Detalles del turno:**
- **Orden completo de la resolución (Fase 5):** decisiones sobre los eventos de la semana anterior → mesa → gestión (construcciones y compras al cartel) → producción → transporte → ventas → tareas → combates → lavado → gastos → calor y ley → lealtad → eventos (cartel y eventos nuevos) → fin de turno.
- **La mesa se vota al comienzo de la resolución**, antes que todo lo demás (paso 2). Si se expulsa a un miembro, su tarea de esa semana se cancela.
- **Iniciativa:** las tareas de todas las facciones se resuelven juntas, ordenadas por iniciativa = stat de la tarea + azar de 0 a 5. Gana el número más alto; los empates se rompen por id del miembro. El orden en que se cargan las órdenes no influye.
- **Órdenes inválidas** (miembro no activo, dos tareas al mismo miembro, tarea no disponible o zona fuera de alcance) se descartan y el informe explica por qué.
- **Heridas y cárcel** se descuentan en el fin de turno. "N semanas" incluye la semana en que empezó: preso 3 semanas en la semana 1 → vuelve a trabajar en la semana 4.
- **Transporte:** llegan las armas compradas al cartel. Pasan por Port Calloway: con calor alto en el puerto, la policía puede incautarlas (calor × 0,5% de chance).

## 5. Mapa

- **18 zonas** conectadas como **grafo de adyacencia**. Se dibuja con tiles, pero la lógica no usa grilla.
  - Cada zona tiene una posición en el mapa (`position`) y un nombre corto (`shortName`) que solo sirven para dibujarla. El grafo es plano: los caminos no se cruzan.
- Tipos de zona: `pueblo`, `ruta`, `puerto`, `rural`, `industrial`.
- Atributos por zona:

| Atributo | Rango | Descripción |
|---|---|---|
| `control` | 0–100 por facción | Influencia de cada facción. El dueño es quien supera 50 y supera al segundo por 20. |
| `riqueza` | 1–5 | Multiplica protección y ventas. |
| `presenciaPolicial` | 0–5 | Base de riesgo de arresto. |
| `calor` | 0–100 | Atención policial acumulada por actividad ilegal. |
| `slotsNegocio` | 0–3 | Cuántos negocios se pueden construir. |

- **La suma del control de todas las facciones en una zona nunca supera 100.** Custodiar solo ocupa el espacio libre; para sacarle control a otro hay que intimidar.
- **Alcance:** una facción puede actuar en las zonas donde tiene control y en sus vecinas.
- **Mapa político (Fase 10):** cada tile del mapa pertenece al distrito más cercano, como un diagrama de Voronoi. Los distritos se pintan con el color de su dueño. Las fronteras entre zonas conectadas se dibujan punteadas (se puede pasar); entre zonas que se tocan sin estar conectadas, gruesas (río o sierra, no hay paso directo). Para que las regiones coincidan con las conexiones, Dry Creek se movió junto a Redwater y se quitó el camino largo Dry Creek–Saltmarsh.
- **Zoom jugable (Fase 10):** con doble clic (o «Entrar al distrito») se ve el mapa local de la zona, generado según su tipo. Cada lugar para negocios es un **lote** concreto: se elige en el mapa y desde ahí se construye (o se propone a la mesa si es ilegal). Se ven los negocios de cada lote con el color de su dueño, nuestros miembros trabajando esa semana y flechas hacia las zonas vecinas.
- **Erosión de influencia (Fase 6):** al final de cada semana, una facción pierde 1 de control en cada zona que no es suya, que no es su sede y donde ningún miembro suyo actuó esa semana. Desparramarse deja de rendir y los empates se rompen. En la simulación, las partidas sin final bajaron del 60% al 10–27%.
- La `riqueza` de una zona es fija durante la partida (por ahora).

Zonas iniciales sugeridas: Redwater (tu sede), Millbrook (sede de los Grim Wolves), Port Calloway (puerto, con presencia del cartel), Ruta 9 norte y sur, el Cruce, Ash Valley Centro (sede del sheriff), entre otras.

## 6. El club

### Miembros
- Empezás con 6 miembros y 2 prospectos. Tope inicial: 15 (ampliable con la sede).
- Stats (1–10): **Fuerza** (combate, intimidar), **Astucia** (robos, evitar arrestos), **Manos** (taller, producción), **Labia** (cobrar, sobornar, reclutar).
- **Lealtad** (0–100) al presidente.
- **Rasgo** (1 por miembro): `Tradicionalista`, `Codicioso`, `Violento`, `Cauto`, `Leal`, `Ambicioso`. Cada rasgo modifica cómo vota y qué eventos dispara.
- **Estado:** `activo`, `herido` (N semanas), `preso` (N semanas), `muerto`.
- **Rango:** Prospecto → Miembro → Sargento de Armas / Tesorero → Vicepresidente. El presidente sos vos, representado por un miembro más.
  - Los prospectos no votan y tienen −2 en todo, pero son baratos y prescindibles.

### La Mesa (votaciones)
Requieren voto: declarar guerra o tregua, aceptar un trato con el cartel, abrir un negocio ilegal nuevo, ascender o expulsar a un miembro.

- Cada miembro con rango Miembro o superior vota. La probabilidad de votar con el presidente depende de su lealtad, su rasgo frente al tipo de propuesta y el resultado de las últimas semanas.
- La propuesta pasa con mayoría simple. Si empata, desempata el presidente.
- **Moción de destitución:** si la lealtad promedio queda < 35 durante 3 semanas, el Vicepresidente (o el más ambicioso) la propone. Si pasa, **perdés**.

**Reglas detalladas de la mesa (Fase 4):**
- Votan los miembros con rango Miembro o superior que estén activos o heridos; los presos no van a la mesa. El presidente siempre vota sus propuestas y gana los empates.
- **Probabilidad de votar con el presidente** = 50% + (lealtad − 50) × 1% + modificador del rasgo (`data/council.json`) + 5% por zona ganada en las últimas 4 semanas (o −5% por zona perdida). Mínimo 5%, máximo 95%.
- Como mucho 2 propuestas por semana. El ascendido siempre vota a favor y el expulsado, en contra.
- **Respetar la mesa:** si una propuesta pierde y la dejás caer, los que votaron ganan +2 de lealtad. **Ignorarla:** podés marcarla como "forzada"; si pierde, se ejecuta igual y los que votaron pierden −8.
- **Ascensos:** Prospecto → Miembro → un cargo libre (Sargento de Armas, Tesorero o Vicepresidente). Hay un solo titular por cargo. El ascendido gana +10 de lealtad.
- **Expulsión:** el miembro deja el club. Si era informante se descubre y la investigación federal baja 10. Al presidente no se lo puede expulsar.
- **La destitución** la propone el Vicepresidente; si no puede, el miembro Ambicioso y, si no hay, el menos leal. Si la mesa sostiene al presidente, la cuenta de semanas vuelve a cero.
- **La IA usa la mesa (Fase 8)**, con las mismas propuestas y votos que el jugador y como mucho 2 propuestas por semana, en este orden de prioridad:
  1. **Tregua:** cuando está en guerra y su lealtad media es menor a 45 o va perdiendo por 2 zonas. Solo la pide si el rival la aceptaría.
  2. **Guerra:** contra quien la trata con −30 o peor, si su Fuerza activa supera en un 10% a la del rival.
  3. **Expulsión:** de los miembros con lealtad menor a 15.
  4. **Ascensos:** cubre cargos vacantes con su Miembro más leal, o asciende a un prospecto con lealtad 60 o más.
  5. **Negocios ilegales y trato con el cartel:** cuando tiene depósito, plata sucia y el cartel la acepta.
- **Sucesión en clubes de la IA (Fase 8):** si su mesa destituye al presidente, asume quien propuso la moción, el anterior vuelve a ser Miembro (con lealtad 30) y el resto del club gana +10 de lealtad. Para el jugador, la destitución sigue siendo derrota.

### Lealtad
Sube con pagos regulares, victorias y respetar el voto de la mesa. Baja con miembros muertos o presos, deudas, ignorar a la mesa, guerras largas y contradecir el rasgo del miembro.
Por debajo de 20, un miembro puede **desertar** o **volverse informante** (ver §10).

**Tope de lealtad pasiva (Fase 6):** el sueldo y el bar no suben la lealtad por encima de 70. Más arriba solo se llega con victorias, ascensos, respetar a la mesa o eventos. Así la lealtad alta se gana.

**Valores semanales (Fase 4, en `balance.json`):** sueldo cobrado +1 · sin cobrar −10 · cada zona ganada +3 y cada zona perdida −3 (para todos) · cada hermano preso esa semana −2 (para todos) · guerra de 8 semanas o más −1 por semana · tarea que le gusta al rasgo +1 · tarea que detesta −3 (gustos en `data/traits.json`). La lealtad del presidente no cambia.
Con lealtad menor a 20, cada semana: 15% de desertar o 10% de volverse informante en secreto. Si hay un informante, cada semana hay 25% de que corra un rumor.

## 7. Tareas (una por miembro y por semana)

| Tarea | Stat | Efecto | Calor |
|---|---|---|---|
| Custodiar zona | Fuerza | +defensa en la zona, +control lento | 0 |
| Cobrar protección | Labia | ingreso sucio = riqueza × control | +3 |
| Intimidar | Fuerza | +control propio, −control rival | +5 |
| Robar motos | Astucia | +1–3 motos robadas | +6 |
| Trabajar en taller | Manos | aporta capacidad de producción | 0 |
| Corrida de armas | Astucia | mueve y vende stock de armas | +10 |
| Atacar negocio rival | Fuerza | combate (ver §11) | +15 |
| Sobornar | Labia | −calor en zona, +relación con sheriff | 0 (cuesta plata) |
| Reclutar | Labia | chance de sumar un prospecto | 0 |
| Bajo perfil | — | −calor de la zona | −5 |

Toda tarea ilegal tiene una **chance de arresto** = f(calor de la zona, presencia policial, Astucia del miembro).
Son ilegales: cobrar protección, intimidar, robar motos, corrida de armas y atacar negocio rival.

### Reglas detalladas (Fase 1)

Todos los números viven en `data/balance.json`.

- **Chance de arresto** = 2% + calor × 0,3% + presencia policial × 2% − Astucia × 1%, +5% si hay patrullas (calor ≥ 30). Mínimo 1%, máximo 60%. El arrestado queda preso 2 a 4 semanas; su tarea no rinde, pero el calor se suma igual.
- **Prospectos:** −2 a todos los stats (nunca menos de 1).
- **Custodiar:** +(1 + Fuerza/3) de control, solo en espacio libre.
- **Cobrar protección:** riqueza × control × (0,5 + Labia × 0,1), en plata sucia. Se cobra una sola vez por zona y por semana.
- **Intimidar:** el rival con más control en la zona pierde (2 + Fuerza/2) y nosotros ganamos lo mismo, limitado al espacio libre.
- **Robar motos:** +1 a 3 motos robadas al stock.
- **Sobornar:** cuesta $150 sucios, −15 de calor en la zona y +5 de relación con el sheriff.
- **Reclutar:** chance = 10% + Labia × 3%. El recluta entra como prospecto, con stats al azar entre 2 y 6, rasgo al azar y lealtad 50. No se recluta si el club llegó al tope.
- **Disponibles en la Fase 1:** custodiar, cobrar, intimidar, robar motos, sobornar, reclutar y bajo perfil. Trabajar en taller y corrida de armas llegan con la Fase 5; atacar negocio rival, con el combate.

## 8. Economía

- **Dos monedas:** **plata sucia** (lo ilegal) y **plata limpia** (lo legal y lo lavado).
- La plata limpia paga construcciones, sueldos visibles y la sede. La sucia paga sobornos, armas y el mercado negro.
- **Lavado:** cada negocio legal tiene una capacidad semanal de lavado. Lavar por encima del 70% de esa capacidad suma calor federal.
- **Gastos semanales:** parte para los miembros (por rango), mantenimiento de negocios, sobornos activos.
- Si no pagás a los miembros, la lealtad cae fuerte (−10 por semana sin cobrar).
- **Sueldos semanales por rango:** prospecto $10, miembro $30, sargento de armas $50, tesorero $50, vicepresidente $60, presidente $0. Se pagan en mano: **primero con plata sucia y, si no alcanza, con limpia.** Cada miembro cobra completo o no cobra. También cobran los presos y los heridos.
- **Plata inicial de los clubes:** $2000 limpios y $500 sucios.

- **Gastos (Fase 5):** el mantenimiento de cada negocio se paga con plata limpia y, si no alcanza, con sucia. Un negocio que no se puede mantener queda **parado**: no produce ni lava hasta que se pague.
- **Lavado (Fase 5):** la capacidad es la suma de los negocios legales que funcionan. Lavar por encima del 70% suma investigación federal (10 puntos por capacidad completa en exceso).

### Negocios (MVP)

| Negocio | Tipo | Función |
|---|---|---|
| Taller mecánico | Legal | Produce motos custom, lava plata |
| Bar del club | Legal | Ingreso bajo, lava plata, +lealtad |
| Desarmadero | Ilegal | Convierte motos robadas en piezas |
| Depósito | Ilegal | Guarda armas (si se allana, perdés el stock) |

**Valores (Fase 5, en `data/businesses.json`):**

| Negocio | Costo | Mantenimiento/semana | Lavado/semana | Función |
|---|---|---|---|---|
| Taller | $1500 | $50 | $400 | 1 moto custom por semana (2 piezas cada una), +1 por cada 4 de Manos de quien trabaje ahí (rinde la semana siguiente) |
| Bar | $1000 | $40 | $300 | $25 limpios × riqueza de la zona; +1 de lealtad a todo el club |
| Desarmadero | $800 | $30 | — | hasta 3 motos robadas por semana → 3 piezas cada una |
| Depósito | $600 | $20 | — | guarda hasta 10 cajas de armas |

- Solo se construye en **zonas propias** con lugar libre, y se paga con plata limpia. Un negocio funciona desde la semana siguiente a su construcción.
- Los legales se construyen desde la gestión; los ilegales necesitan el voto de la mesa.

## 9. Bienes y cadenas de producción

**Bienes del MVP:** moto robada, piezas, moto custom, caja de armas.

**Cadena A — Motos:**
```
Robar motos → [Moto robada] → Desarmadero → [Piezas ×3] → mercado negro (sucio)
                                                    ↘ Taller (+Manos) → [Moto custom] → venta legal (limpio)
```

**Cadena B — Armas:**
```
Trato con Cartel Valdés → compra en Port Calloway → [Caja de armas] → Depósito → Corrida de armas → venta (sucio, mucho calor)
```

**Cadena C — Protección:** sin bienes. Es ingreso por control de zona.

**Cadena D — Marihuana (Fase 9):**
```
Plantación (ilegal, solo en zonas rurales) → [Marihuana ×2 por semana, +Manos/3 si alguien hace "Cultivar"] → Menudeo (sucio)
```

**Cadena E — Cocaína (Fase 9):**
```
Trato con el cartel → compra de [Kilo] ($1200, llega por el puerto) → Cocina de corte (ilegal; pueblo, puerto o industrial)
→ [Dosis ×8 por kilo, hasta 2 kilos por semana] → Menudeo (sucio, +0,25 de investigación federal por dosis)
```

- **Menudeo (tarea, Labia, ilegal, +4 de calor):** vende en la calle hasta 3 + Labia/2 unidades, con un tope de riqueza de la zona × 3. Vende primero lo más caro. Las drogas solo se venden así, nunca desde la gestión.
- **Cultivar (tarea, Manos, ilegal, +2 de calor):** como "Trabajar en taller", pero en una plantación propia.
- **Calor por producir:** la plantación suma +1 de calor por semana en su zona y la cocina, +3, cuando producen.
- **Valores:** marihuana $90 (referencia 10); dosis $220 (referencia 16). Plantación: $700 y $25 de mantenimiento. Cocina: $1500 y $60 de mantenimiento, guarda 4 kilos.
- **Catálogo del cartel:** caja de armas $250, kilo $1200. Los dos tipos de compra usan el mismo trato.
- **Rasgos:** a los Tradicionalistas y a los Cautos no les gusta el menudeo; a los Codiciosos, sí.

Los precios tienen un mercado simple por bien: el precio base varía ±20% según la oferta reciente (si vendés mucho, baja).

**Mercado (Fase 5):** precio = base × (1 + 0,2 × (1 − 2 × saturación)), donde saturación = ventas recientes ÷ referencia del bien (tope 1). Sin ventas recientes, +20%; con la referencia alcanzada, −20%. Las ventas recientes se reducen a la mitad cada semana.

| Bien | Precio base | Moneda | Referencia |
|---|---|---|---|
| Moto robada | no se vende: va al desarmadero | — | — |
| Piezas | $60 | sucia | 12 |
| Moto custom | $600 | limpia | 3 |
| Caja de armas | $400 (al cartel se compra a $250) | sucia | 6 |

- **Corrida de armas:** vende 2 + Astucia/3 cajas al precio de mercado y suma +2 de investigación federal.
- **Robar motos:** las motos van al stock; el desarmadero las procesa.

## 10. Calor y ley

- **Calor por zona** (0–100). Baja 5 por semana de forma natural.
- **Orden dentro de "calor y ley" (Fase 4):** operativos → allanamientos → presencia policial → investigación federal → desgaste del sheriff → baja natural del calor.
  - **Operativo (≥ 85):** cada miembro que actuó en la zona esa semana tiene 50% de caer preso; después el calor de la zona baja 30.
  - **Allanamiento (≥ 60):** cada negocio ilegal de la zona tiene 30% de ser clausurado. Si el sheriff te tiene en 50 o más, primero avisa y el allanamiento puede llegar recién la semana siguiente.
  - **Policía:** con calor ≥ 60 la presencia policial de la zona sube 1 por semana (hasta 5). Con calor < 30 vuelve de a 1 a su valor de base.
- **Umbrales de zona:** 30 → patrullas (+riesgo de arresto); 60 → allanamiento posible de negocios ilegales; 85 → operativo, con arrestos masivos en la zona.
- **Sheriff:** relación de −100 a 100. Los sobornos reducen el calor generado en sus zonas. Si la relación es muy alta, avisa antes de un allanamiento.
  - La relación se guarda del lado del sheriff (cómo te trata) y se acerca a 0 de a 2 por semana. El condado entero es su jurisdicción: con relación positiva, el calor que generan tus tareas baja hasta un 50% (proporcional a la relación).
- **Investigación federal** (0–100%, global): sube por lavado excesivo, corridas de armas, muertes y calor alto sostenido. **No se soborna.**
  - Se lleva **una por club** (la IA sigue las mismas reglas). Cada semana: +0,5 por cada zona con calor ≥ 60 donde el club tiene control, +2 por cada informante y −2 si el club no hizo ninguna tarea ilegal. Si un club de la IA llega a 100, sus miembros activos caen presos y su investigación vuelve a 50.
  - Baja solo con semanas de perfil bajo, eliminando informantes o con eventos especiales.
  - Al 100% → **redada federal → derrota.**
- **Informantes:** un miembro con lealtad < 20 puede volverse informante en secreto (+investigación cada semana). Las pistas aparecen en eventos.

## 11. Conflicto

- **Autorresuelto**, con reporte en texto.
- Fuerza de cada bando = Σ(Fuerza de los participantes) + armas + bonus de defensa (custodia, sede) ± aleatoriedad (semilla).
- Resultado: ganador, cambio de control, bajas por miembro (`herido` / `preso` / `muerto`), daño a negocios.
- Cada combate suma calor fuerte en la zona y una pequeña cantidad a la investigación federal.

**Reglas detalladas (Fase 5):**
- **Ataque:** todos los miembros de un club que eligieron "Atacar negocio rival" en la misma zona pelean juntos. Atacan el negocio rival más caro de la zona (nunca uno de un club con tregua).
- **Defensa:** los miembros del dueño que custodiaron esa zona esa semana. Si es la sede del dueño, suma +4.
- **Fuerza de cada bando** = Σ Fuerza efectiva + 1 por caja de armas en stock (hasta 1 por combatiente) + bonus + azar de 0 a 6. El atacante gana solo si supera a la defensa.
- **Si gana el atacante:** destruye el negocio y le saca 10 de control al dueño.
- **Si gana el defensor:** le saca 10 de control al atacante.
- **Bajas del bando perdedor**, por miembro: 5% de morir, 10% de caer preso y 40% de quedar herido (2 a 4 semanas). Del ganador, 15% de quedar herido.
- **Efectos:** +10 de calor en la zona; +1 de investigación federal para cada bando y +3 por cada muerto; −5 de lealtad para todo el club por cada muerto. La víctima empeora su relación con el atacante.

## 12. Facciones IA

| Facción | Comportamiento |
|---|---|
| Grim Wolves MC | Expansiva: disputa zonas vecinas, ataca negocios, responde a agresiones |
| Cartel Valdés | Comercial: ofrece tratos de armas. Si incumplís, castiga. No busca territorio salvo en el puerto. (Fase 5: tiene 3 miembros que solo actúan en Port Calloway.) |
| Sheriff | Reactivo al calor; corruptible |
| Federales | Invisibles hasta que la investigación pasa 50% |

**Relaciones** de −100 a 100, con estados: `guerra`, `tensión`, `neutral`, `trato`.
La IA usa las mismas reglas y tareas que el jugador. Nada de trampas.

- **Las agresiones se recuerdan:** cuando una facción pierde control porque la intimidaron, su relación con el agresor baja 5. El informe le avisa a la víctima.
- **Cómo decide la IA (Fase 2):** para cada miembro libre evalúa todas las tareas en todas las zonas a su alcance y estima el valor esperado de cada opción: plata, control, quedarse con la zona, riesgo de arresto y calor. Elige la mejor combinación, la descuenta de una proyección del estado (así dos miembros no persiguen lo mismo) y repite. Los pesos de cada personalidad están en `data/ai.json`:
  - **`expansive`** (Grim Wolves): disputa zonas vecinas y le saca control al rival.
  - **`balanced`**: valora más consolidar lo propio y defender su sede. Lo usa el simulador para jugar por los Iron Saints.
  - Las dos defienden lo propio con más fuerza, responden a las agresiones (la facción que peor las trata pasa a ser su enemiga) y, si les falta plata, priorizan cobrar antes que expandirse o reclutar.
- **Gestión de la IA (Fase 5):** vende lo que produce, lava hasta el 70% de su capacidad, construye un bar, pide a la mesa un desarmadero y después construye un taller. Roba motos solo si el desarmadero puede procesarlas, custodia las zonas con negocios propios que un rival puede alcanzar y ataca negocios rivales según su chance estimada de ganar.
- **Trato con el cartel (Fase 5):** lo vota la mesa. El cartel acepta si su relación con el club es de −20 o más. Las cajas cuestan $250 sucios y necesitan lugar en un depósito. Si pasan 2 semanas sin comprar, el cartel da el trato por roto: su relación baja 40 y le da una paliza a un miembro (herido 2 a 4 semanas).

## 13. Eventos

Eventos narrativos en `data/events.json`, cada uno con condiciones, texto, opciones y efectos.

**Funcionamiento (Fase 5):**
- Cada semana, **cada club** tiene 30% de chance de un evento (Fase 8: los clubes de la IA también). La IA elige la opción con mejor valor esperado; los valores están en `data/ai.json` (`eventValues`). "El rival" de un evento es el club que peor trata a quien lo recibe. Si un miembro tuyo se pasa a otro club por un evento, el informe te avisa.
- Se elige uno al azar (según su peso) entre los que cumplen sus condiciones y no ocurrieron en las últimas 10 semanas.
- El jugador decide antes de avanzar la semana y la decisión se aplica al comienzo de la siguiente. Si no decide, o no puede pagar la opción elegida, se aplica la opción por defecto.
- **Condiciones posibles:** semana mínima, tener un prospecto, tener un informante, que el rival tenga al menos N miembros.
- **Efectos posibles:** plata, lealtad (todos, el protagonista o el resto), relación con el sheriff o con el rival, calor en una zona, ascender al protagonista, que el protagonista se pase al club, un preso al azar, descubrir al informante y efectos con probabilidad (sale bien / sale mal).

Ejemplos:
- Un prospecto pide un parche completo antes de tiempo.
- El sheriff pide un "aporte para la campaña".
- Un miembro de los Grim Wolves quiere cambiarse de club.
- Un camión con carga mal custodiada pasa por la Ruta 9.
- Sospechás que hay un informante: ¿investigar o ignorar?

## 14. Victoria y derrota

- **Victoria:** controlar 12 de las 18 zonas durante 4 semanas seguidas, **o** expulsar a los Grim Wolves del condado (que no les quede control en ninguna zona).
- **Derrota:** destitución en la mesa, investigación federal al 100%, quedarte con menos de 3 miembros activos (Fase 6: "activos" significa que siguen en el club, aunque estén presos o heridos; no cuentan los muertos, los desertores ni los expulsados), **perder el control de todas las zonas**, o que **un club rival cumpla la victoria por territorio** (12 zonas durante 4 semanas).

## 15. Interfaz y arte

- **Pantallas:** Mapa (principal), Club (tabla de miembros), Mesa (votaciones), Negocios y stock, Informe semanal.
- El mapa va en canvas (PixiJS). Paneles, tablas y menús en HTML/CSS superpuesto.
- **Fase 3 (hecha):** mapa ASCII con cajas de 3×3 tiles por zona. El borde toma el color del dueño, `!` marca patrullas y los nombres apagados indican zonas fuera de alcance. A la derecha hay tres pestañas:
  - **Club:** tarea y zona de cada miembro. La zona se elige de la lista o haciendo click en el mapa.
  - **Zona:** datos, control por facción, vecinas y nuestras tareas ahí.
  - **Informe:** lo que pasó en la semana, por etapa.
- Las órdenes de la semana anterior se conservan si siguen siendo válidas. La partida se guarda sola en el navegador al terminar cada semana.
- **Fase 6 (hecha):**
  - **Guardar y cargar:** «Guardar» descarga la partida como `.json` y «Cargar» la abre. Al cargar se valida el formato y que coincida con los datos actuales del juego; si no coincide, se explica por qué.
  - **Mapa:** los negocios se dibujan en el borde superior de cada zona con el color del dueño, las zonas con tareas planeadas se resaltan, al pasar el mouse se ve un resumen y hay una leyenda debajo.
  - **Partida:** ayuda «Cómo se juega» (botón «?»), pantalla de fin de partida y Enter para avanzar la semana.
  - **Arte:** ASCII con color por tipo de zona (pueblo, ruta, puerto, rural, industrial). Los colores están en `data/ui.json`.
- **Tileset (decidido):** *1-Bit Pack* de Kenney (CC0), en `assets/tiles/` junto con su licencia. Los tiles son blancos y se tiñen: ícono por tipo de zona en el centro de cada caja y negocios en el borde superior con el color del dueño. Las coordenadas de cada sprite están en `data/ui.json`. Los nombres y caminos siguen en texto, y un botón permite volver al modo ASCII.
- **Arte:** tiles de 16×16, escalado entero (×2, ×3), paleta limitada.
  - **Fase inicial:** glifos ASCII de una fuente bitmap, estilo Dwarf Fortress.
  - **Después:** tileset CC0 (por ejemplo el *1-Bit Pack* de Kenney) o arte propio. Decisión pendiente.
- Todo el texto de la interfaz está en español y centralizado en `data/strings.es.json`.

## 16. Fuera de alcance (MVP)

Varios chapters, mapa de varios condados, combate táctico, diplomacia compleja, multijugador, sonido, personajes con historia propia.
(Las drogas como cadena salieron de esta lista por pedido del dueño: ver Fase 9.)

## 17. Roadmap

| Fase | Objetivo | Resultado jugable |
|---|---|---|
| 0 | Esqueleto: repo, tipos, carga de datos, RNG con semilla, tests | `npm test` en verde |
| 1 | Simulación núcleo en consola: zonas, miembros, tareas básicas, economía | Partida por texto en la terminal |
| 2 | Simulador headless + IA de Grim Wolves | `npm run sim` con 100 semanas y estadísticas (`--runs N` para varias partidas, `--player ai|random|idle`) |
| 3 | Mapa en PixiJS + panel de club + avanzar semana | Primera versión jugable en el navegador |
| 4 | Mesa, lealtad, calor, sheriff, federales | El loop completo |
| 5 | Cadenas de producción, cartel, eventos | Contenido |
| 6 | Arte, pulido de interfaz, guardar y cargar, balance | Prototipo "terminado" |
| 7 (opcional) | Empaquetado con Tauri a .exe | Juego de PC (instalador `.exe` armado por GitHub Actions; ver `docs/ESCRITORIO.md`) |
| 8 | IA que juega como el jugador: usa la mesa (guerra, tregua, ascensos, expulsiones, cartel, negocios ilegales), compra armas, tiene eventos y los decide; sucesión en clubes de la IA | Rivales que toman decisiones visibles y coherentes |
| 9 | Dos cadenas nuevas: marihuana (plantación propia en zonas rurales) y cocaína (trato con el cartel, laboratorio de corte, distribución) | Más variedad económica |
| 10 | Mapa político (límites de distrito como bordes, estilo overworld de *Caves of Qud*) y zoom jugable a cada zona: mapa local donde se elige el tile de cada negocio | Mapa nuevo |
| 11 | Identidad del club: nombre editable y parche elegido entre 50 diseños pixel art; los rivales también tienen parche; el parche se ve en la barra, el club y el mapa | Pantalla de nueva partida |

**Feedback del dueño después de jugar v0.1.0 (origen de las fases 8 a 11):** la IA tiene que decidir como el jugador; hacen falta más cadenas para que no sea repetitivo; nombre y parche propios; y un mapa político con zoom a cada zona.

## 18. Decisiones de la Fase 1

Huecos del GDD que se cerraron al implementar la Fase 1, con el acuerdo del dueño. Los números son iniciales y se ajustan con el simulador.

| Pregunta | Decisión |
|---|---|
| ¿Plata inicial? | $2000 limpios y $500 sucios por club. |
| ¿Relaciones iniciales? | Todas neutrales (0). |
| ¿Sueldos por rango? | Prospecto 10, miembro 30, sargento y tesorero 50, VP 60, presidente 0. |
| ¿Con qué plata se pagan los sueldos? | Primero con sucia y después con limpia. Sin lavado (Fase 5), la limpia no tendría de dónde salir. |
| ¿Cuánto control dan custodiar e intimidar? | 1 + Fuerza/3 y 2 + Fuerza/2, respectivamente. Ver §7. |
| ¿Puede el control total de una zona pasar de 100? | No. La suma de todas las facciones es como máximo 100. |
| ¿Dónde puede actuar un miembro? | En zonas con control propio y en sus vecinas. |
| ¿Fórmula de arresto? | Ver §7. Cárcel de 2 a 4 semanas. |
| ¿Qué tareas son ilegales? | Cobrar, intimidar, robar motos, corrida de armas y atacar negocio. Sobornar no lo es: cuesta plata, pero no tiene riesgo. |
| ¿Qué es "por iniciativa"? | Stat de la tarea + azar de 0 a 5, sin importar la facción. |
| ¿Qué pasa en "transporte"? | Mover stock entre negocios (Fase 5). Hasta entonces no hace nada. |
| ¿Qué es el "estrés" de Bajo perfil? | Se saca del MVP: no existe esa stat. |
| ¿La riqueza de una zona cambia? | No, es fija por ahora. |
| ¿Cuándo se descuentan las semanas de cárcel o heridas? | En el fin de turno, contando la semana en que empezó. |
| ¿Qué significa "expulsar a los Grim Wolves"? | Que no les quede control en ninguna zona. |
| ¿Qué pasa si un rival domina el condado? (Fase 2) | Perdés. La IA juega con las mismas reglas, así que su victoria por territorio es tu derrota. |
| ¿Y si te quedás sin control en ninguna zona? (Fase 2) | Perdés: sin territorio no tenés dónde actuar. |
| ¿Cómo "responde a agresiones" la IA? (Fase 2) | Intimidar a alguien le baja 5 de relación con el agresor. Con relación de −15 o menos, la IA lo trata como enemigo y prioriza golpearlo. |
| ¿En qué fase entra el combate (§11)? (Fase 2) | Pendiente. El roadmap no lo ubica y requiere negocios (Fase 5) para "atacar negocio rival". Propuesta: implementarlo junto con los negocios. |
| ¿Cómo se dibuja un grafo en tiles? (Fase 3) | Cada zona tiene una posición fija en `zones.json`. Para que el mapa sea plano y legible se quitó la conexión Hollister Junction–Lone Pine; en las simulaciones ninguna IA llegaba a esas zonas, así que no cambió nada. |
| ¿Dónde se guarda la partida en el navegador? (Fase 3) | Autoguardado en el navegador al final de cada semana. Guardar y cargar con archivos queda para la Fase 6. |
| ¿Cuándo vota la mesa dentro del turno? (Fase 4) | Al comienzo de la resolución, antes de producción. |
| ¿Cómo se calcula el voto? (Fase 4) | Ver §6: lealtad, rasgo y zonas ganadas o perdidas en las últimas 4 semanas. |
| ¿Qué es "ignorar a la mesa"? (Fase 4) | Forzar una propuesta que perdió: se ejecuta igual y los que votaron pierden lealtad. |
| ¿Qué hacen la guerra y la tregua? (Fase 4) | Guerra: las dos relaciones bajan a −60, intimidar al enemigo mueve +2 de control, la IA lo prioriza y desde la semana 8 desgasta la lealtad. Tregua: dura 8 semanas y nadie puede intimidar al otro. El rival la acepta salvo que vaya ganando en zonas y su relación sea menor a −40. |
| ¿Estados de relación? (Fase 4) | Guerra y tregua son explícitos. Si no hay ninguno, "tensión" con relación ≤ −15 y "neutral" en el resto. "Trato" queda para el cartel (Fase 5). |
| ¿La investigación federal es una sola? (Fase 4) | Una por club, para que la IA juegue con las mismas reglas. |
| ¿Qué es "semana de perfil bajo"? (Fase 4) | Una semana en la que el club no hizo ninguna tarea ilegal: −2 de investigación. |
| ¿Dónde mandan los sobornos del sheriff? (Fase 4) | En todo el condado. Su buena voluntad se desgasta 2 por semana; los "sobornos activos" como gasto fijo quedan pendientes. |
| ¿Qué pasa con un club de la IA al 100% federal? (Fase 4) | Sus miembros activos caen presos y la investigación vuelve a 50. |
| ¿El combate? (Fase 5) | Entra con los negocios. Ver §11. |
| ¿Dónde se guarda el stock? (Fase 5) | Por facción, no por negocio. Los depósitos solo limitan cuántas armas se pueden tener. Si allanan el último depósito, se pierden las armas que no entran. |
| ¿Qué es el "transporte"? (Fase 5) | La entrega de las armas del cartel, con riesgo de incautación en el puerto. |
| ¿Cuándo rinde "trabajar en taller"? (Fase 5) | Las tareas se resuelven después de la producción, así que el trabajo suma capacidad para la semana siguiente. |
| ¿Quién paga sueldos? (Fase 5) | Solo los clubs. El cartel no paga sueldos ni tiene mesa. |
| ¿Eventos para la IA? (Fase 5 → Fase 8) | Sí: desde la Fase 8 todos los clubes tienen eventos y los deciden. |
| ¿Ventaja de los Grim Wolves? (Fase 6) | Se igualó la Fuerza total de los dos clubs (40 cada uno). Con +3 de Fuerza, los Wolves ganaban casi siempre en la simulación. |
| ¿"Menos de 3 miembros activos"? (Fase 6) | Cuenta a los que siguen en el club, aunque estén presos o heridos. Una racha de arrestos ya no termina la partida. |
| ¿La lealtad sube sola sin límite? (Fase 6) | No: el sueldo y el bar la suben hasta 70 como mucho. |
| ¿Cuántos miembros recluta la IA? (Fase 6) | Hasta el tope de 15. Con menos, no le alcanzaba la gente para cobrar en todas sus zonas y además expandirse. |
| ¿Cómo se rompen los empates? (Fase 6) | Con la erosión de influencia (§5). |
| ¿Con qué IA juega el simulador por el jugador? (Fase 6) | Con el mismo perfil que los Wolves ("expansive"), para que la comparación sea pareja. Ojo: en la simulación solo el jugador puede perder por destitución; los clubs de la IA no. |
| ¿Hay sucesión? (Fase 8) | Para los clubes de la IA, sí (ver §6). Para el jugador, perder la presidencia sigue siendo derrota. La muerte del presidente sigue abierta. |
| ¿La IA es prudente? (Fase 8) | Con el club en malestar, le pesa el doble el riesgo de arresto. No pide treguas ni tratos que le van a rechazar. |
| ¿Cómo se generalizaron los negocios? (Fase 9) | En `businesses.json`, un **procesador** convierte un bien en otro solo (desarmadero, cocina de corte) y un **taller** produce, con o sin insumo, y rinde más si alguien hace su tarea de trabajo (taller, plantación). Cada negocio puede limitar los tipos de zona y sumar calor por semana. |
| ¿La IA usa las drogas? (Fase 9) | Sí: construye cocinas solo si el cartel le vendería, no intimida al cartel mientras quiere negociar con él, cultiva si tiene buenas Manos y sale a vender cuando tiene stock. La plantación la usa poco porque rara vez es dueña de una zona rural. |
| ¿Los lotes cambian las reglas? (Fase 10) | Solo agregan dónde: cada negocio ocupa un lote (0 a lugares−1). Construir en un lote ocupado o inexistente se rechaza; sin lote, se usa el primero libre (así construye la IA). |
| ¿Mapa inicial? | 18 zonas en `data/zones.json`, con Redwater al sur, Millbrook al norte, El Cruce en el medio y Port Calloway en la costa. |

## 19. Preguntas abiertas

- ¿Nombre final del juego? (El del club ya lo elige el jugador.)
- ¿El presidente puede morir? (La sucesión ya existe para los clubes de la IA.)
- ¿Agregar una tercera cadena (contrabando de alcohol o tabaco) en la fase 5?
