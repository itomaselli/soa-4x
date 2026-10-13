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

## 5. Mapa

- **18 zonas** conectadas como **grafo de adyacencia**. Se dibuja con tiles, pero la lógica no usa grilla.
- Tipos de zona: `pueblo`, `ruta`, `puerto`, `rural`, `industrial`.
- Atributos por zona:

| Atributo | Rango | Descripción |
|---|---|---|
| `control` | 0–100 por facción | Influencia de cada facción. El dueño es quien supera 50 y supera al segundo por 20. |
| `riqueza` | 1–5 | Multiplica protección y ventas. |
| `presenciaPolicial` | 0–5 | Base de riesgo de arresto. |
| `calor` | 0–100 | Atención policial acumulada por actividad ilegal. |
| `slotsNegocio` | 0–3 | Cuántos negocios se pueden construir. |

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

### Lealtad
Sube con pagos regulares, victorias y respetar el voto de la mesa. Baja con miembros muertos o presos, deudas, ignorar a la mesa, guerras largas y contradecir el rasgo del miembro.
Por debajo de 20, un miembro puede **desertar** o **volverse informante** (ver §10).

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
| Bajo perfil | — | −calor de la zona, +recupera estrés | −5 |

Toda tarea ilegal tiene una **chance de arresto** = f(calor de la zona, presencia policial, Astucia del miembro).

## 8. Economía

- **Dos monedas:** **plata sucia** (lo ilegal) y **plata limpia** (lo legal y lo lavado).
- La plata limpia paga construcciones, sueldos visibles y la sede. La sucia paga sobornos, armas y el mercado negro.
- **Lavado:** cada negocio legal tiene una capacidad semanal de lavado. Lavar por encima del 70% de esa capacidad suma calor federal.
- **Gastos semanales:** parte para los miembros (por rango), mantenimiento de negocios, sobornos activos.
- Si no pagás a los miembros, la lealtad cae fuerte.

### Negocios (MVP)

| Negocio | Tipo | Función |
|---|---|---|
| Taller mecánico | Legal | Produce motos custom, lava plata |
| Bar del club | Legal | Ingreso bajo, lava plata, +lealtad |
| Desarmadero | Ilegal | Convierte motos robadas en piezas |
| Depósito | Ilegal | Guarda armas (si se allana, perdés el stock) |

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

Los precios tienen un mercado simple por bien: el precio base varía ±20% según la oferta reciente (si vendés mucho, baja).

## 10. Calor y ley

- **Calor por zona** (0–100). Baja 5 por semana de forma natural.
- **Umbrales de zona:** 30 → patrullas (+riesgo de arresto); 60 → allanamiento posible de negocios ilegales; 85 → operativo, con arrestos masivos en la zona.
- **Sheriff:** relación de −100 a 100. Los sobornos reducen el calor generado en sus zonas. Si la relación es muy alta, avisa antes de un allanamiento.
- **Investigación federal** (0–100%, global): sube por lavado excesivo, corridas de armas, muertes y calor alto sostenido. **No se soborna.**
  - Baja solo con semanas de perfil bajo, eliminando informantes o con eventos especiales.
  - Al 100% → **redada federal → derrota.**
- **Informantes:** un miembro con lealtad < 20 puede volverse informante en secreto (+investigación cada semana). Las pistas aparecen en eventos.

## 11. Conflicto

- **Autorresuelto**, con reporte en texto.
- Fuerza de cada bando = Σ(Fuerza de los participantes) + armas + bonus de defensa (custodia, sede) ± aleatoriedad (semilla).
- Resultado: ganador, cambio de control, bajas por miembro (`herido` / `preso` / `muerto`), daño a negocios.
- Cada combate suma calor fuerte en la zona y una pequeña cantidad a la investigación federal.

## 12. Facciones IA

| Facción | Comportamiento |
|---|---|
| Grim Wolves MC | Expansiva: disputa zonas vecinas, ataca negocios, responde a agresiones |
| Cartel Valdés | Comercial: ofrece tratos de armas. Si incumplís, castiga. No busca territorio salvo en el puerto. |
| Sheriff | Reactivo al calor; corruptible |
| Federales | Invisibles hasta que la investigación pasa 50% |

**Relaciones** de −100 a 100, con estados: `guerra`, `tensión`, `neutral`, `trato`.
La IA usa las mismas reglas y tareas que el jugador. Nada de trampas.

## 13. Eventos

Eventos narrativos en `data/events.json`, cada uno con condiciones, texto, opciones y efectos. Ejemplos:
- Un prospecto pide un parche completo antes de tiempo.
- El sheriff pide un "aporte para la campaña".
- Un miembro de los Grim Wolves quiere cambiarse de club.
- Un camión con carga mal custodiada pasa por la Ruta 9.
- Sospechás que hay un informante: ¿investigar o ignorar?

## 14. Victoria y derrota

- **Victoria:** controlar 12 de las 18 zonas durante 4 semanas seguidas, **o** expulsar a los Grim Wolves del condado.
- **Derrota:** destitución en la mesa, investigación federal al 100%, o quedarte con menos de 3 miembros activos.

## 15. Interfaz y arte

- **Pantallas:** Mapa (principal), Club (tabla de miembros), Mesa (votaciones), Negocios y stock, Informe semanal.
- El mapa va en canvas (PixiJS). Paneles, tablas y menús en HTML/CSS superpuesto.
- **Arte:** tiles de 16×16, escalado entero (×2, ×3), paleta limitada.
  - **Fase inicial:** glifos ASCII de una fuente bitmap, estilo Dwarf Fortress.
  - **Después:** tileset CC0 (por ejemplo el *1-Bit Pack* de Kenney) o arte propio. Decisión pendiente.
- Todo el texto de la interfaz está en español y centralizado en `data/strings.es.json`.

## 16. Fuera de alcance (MVP)

Varios chapters, mapa de varios condados, combate táctico, diplomacia compleja, multijugador, sonido, drogas como cadena (se puede agregar más adelante), personajes con historia propia.

## 17. Roadmap

| Fase | Objetivo | Resultado jugable |
|---|---|---|
| 0 | Esqueleto: repo, tipos, carga de datos, RNG con semilla, tests | `npm test` en verde |
| 1 | Simulación núcleo en consola: zonas, miembros, tareas básicas, economía | Partida por texto en la terminal |
| 2 | Simulador headless + IA de Grim Wolves | `npm run sim` con 100 semanas y estadísticas |
| 3 | Mapa en PixiJS + panel de club + avanzar semana | Primera versión jugable en el navegador |
| 4 | Mesa, lealtad, calor, sheriff, federales | El loop completo |
| 5 | Cadenas de producción, cartel, eventos | Contenido |
| 6 | Arte, pulido de interfaz, guardar y cargar, balance | Prototipo "terminado" |
| 7 (opcional) | Empaquetado con Tauri a .exe | Juego de PC |

## 18. Preguntas abiertas

- Arte: ¿ASCII definitivo, tileset CC0 o arte propio?
- ¿Nombre final del juego y del club?
- ¿El presidente puede morir? ¿Hay sucesión?
- ¿Agregar una tercera cadena (contrabando de alcohol o tabaco) en la fase 5?
