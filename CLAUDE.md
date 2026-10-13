# CLAUDE.md

Juego 4X por turnos semanales sobre un club de motoqueros (ver `docs/GDD.md`).
Proyecto hobby. El dueño **no programa**: todo el código lo escribe Claude Code.
Por eso cada cambio tiene que poder **verificarse solo** (tests, simulador headless, typecheck).

## Antes de cualquier tarea

1. Leé `docs/GDD.md`, que es la fuente de verdad de las reglas.
2. Si una tarea contradice el GDD o el GDD no la cubre, **preguntá** antes de inventar una regla.
3. Si cambiás una regla con el acuerdo del dueño, actualizá el GDD en el mismo cambio.

## Stack

- TypeScript (`strict: true`), Vite, PixiJS (render 2D), HTML/CSS (interfaz)
- Vitest (tests), zod (validación de los JSON de datos)
- Sin frameworks de UI pesados al principio. DOM simple o un componente mínimo.
- Más adelante, Tauri para empaquetar a .exe (no ahora).

## Comandos

```bash
npm run dev          # juego en el navegador
npm test             # tests (Vitest)
npm run typecheck    # tsc --noEmit
npm run lint
npm run sim -- --weeks 100 --seed 42   # simulación headless con IA en todos los bandos
npm run play -- --seed 42              # partida en modo texto (--load saves/autosave.json para seguir)
```

**Una tarea está terminada solo si** `typecheck`, `lint` y `test` pasan. Si tocaste reglas de simulación, corré también `npm run sim` y mencioná si cambió algo raro en las estadísticas.

## Arquitectura

```
src/
  sim/        # simulación pura: SIN DOM, SIN PixiJS, SIN Math.random, SIN Date
    state.ts      # tipos de GameState (todo serializable a JSON)
    turn.ts       # resolveTurn(state, orders, rng) → { state, report }
    systems/      # un archivo por sistema: economy, production, heat, loyalty, council, combat, ai...
    rng.ts        # RNG con semilla (por ejemplo mulberry32); el estado del RNG vive en GameState
  data/       # carga y validación (zod) de /data/*.json
  render/     # PixiJS: mapa, tiles, cámara (solo lee el estado)
  ui/         # paneles HTML: club, mesa, negocios, informe
  cli/        # simulador headless y modo texto
data/         # contenido y balance: zones.json, members.json, tasks.json, goods.json,
              # businesses.json, factions.json, events.json, balance.json, strings.es.json
assets/       # sprites y fuentes bitmap
docs/GDD.md
tests/
```

### Reglas de oro

1. **`src/sim` no importa nada de `render`, `ui` ni APIs del navegador.** Tiene que correr en Node.
2. **Determinismo:** la misma semilla con las mismas órdenes da el mismo resultado. Toda aleatoriedad pasa por `rng`.
3. **Estado serializable:** `GameState` es datos planos (sin clases ni funciones). Guardar y cargar es `JSON.stringify` / `parse` más validación.
4. **Nada de números mágicos en el código.** Los valores de balance van en `data/balance.json` o en el JSON del contenido.
5. **Orden de resolución del turno fijo**, tal como está definido en el GDD §4.
6. **Toda resolución genera entradas de reporte** legibles (`report: ReportEntry[]`) que explican el porqué. Ayudan al jugador y a depurar.
7. **La IA usa las mismas órdenes y reglas que el jugador.**
8. La interfaz **nunca muta el estado directamente**: genera órdenes y llama a la simulación.

## Convenciones

- Código, identificadores y comentarios en **inglés**. Textos de la interfaz en **español**, siempre desde `data/strings.es.json`.
- IDs como strings legibles (`"zone_redwater"`, `"faction_grim_wolves"`).
- Funciones puras y pequeñas en `sim/systems`. Preferir `structuredClone` o actualizaciones inmutables simples.
- Cada regla nueva lleva un test que la describe en español en el `describe`/`it`. Ejemplo: `it("cobrar protección rinde riqueza × control")`.
- Tests de propiedades donde aplique (por ejemplo, el dinero nunca es NaN y el control de una zona nunca supera 100).
- Commits chicos, con un mensaje que diga qué regla o feature se tocó.

## Arte (por ahora)

- Placeholder: glifos ASCII de una fuente bitmap en tiles de 16×16, escalado entero, `roundPixels` activo y `scaleMode: nearest`.
- El render toma un `glyph` / `spriteId` desde los datos, así que cambiar a un tileset después no debería tocar la lógica.

## Qué NO hacer

- No agregar dependencias grandes sin preguntar.
- No meter lógica de juego en `render/` ni en `ui/`.
- No usar `any`, `Math.random()` ni `Date.now()` dentro de `src/sim`.
- No implementar nada de "Fuera de alcance" (GDD §16) sin que lo pidan.
- No cambiar valores de balance "para que pase un test". Si un test de balance falla, reportalo.

## Al terminar una tarea

Resumí en 3 a 6 líneas, en español y sin jerga: qué cambió, cómo se prueba (comando o qué mirar en el juego) y qué quedó pendiente o dudoso.
