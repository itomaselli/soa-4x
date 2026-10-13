# Versión de escritorio (Windows)

El juego se empaqueta como aplicación de escritorio con [Tauri](https://tauri.app). El instalador `.exe`
para Windows se compila en GitHub, así que no hace falta instalar nada en tu computadora.

## Conseguir el instalador

1. Entrá al repo en GitHub → pestaña **Actions** → **Compilar para Windows**.
2. Apretá **Run workflow** (rama `main`). Tarda unos 10–15 minutos la primera vez.
3. Cuando termine (tilde verde), abrí la ejecución y bajá el artefacto **biker4x-windows**.
   Adentro está el instalador `Biker 4X_x.y.z_x64-setup.exe` (y un `.msi` alternativo).

Para publicar una versión con el instalador adjunto, creá un tag `v0.1.0` (o el número que corresponda):
el mismo workflow arma una **Release** en GitHub.

> Windows puede mostrar "Windows protegió su PC" porque el instalador no está firmado. Es normal en un
> proyecto hobby: "Más información" → "Ejecutar de todas formas".

## Qué hace el workflow

Instala Node y Rust en una máquina Windows de GitHub, corre `typecheck`, `lint` y `test`, compila el juego
web (`npm run build`) y lo empaqueta con `npx tauri build`.

## Compilar en tu propia máquina (opcional)

Requiere Rust (<https://rustup.rs>). Después:

```bash
npm run desktop:dev     # abre el juego en una ventana de escritorio
npm run desktop:build   # arma el instalador para el sistema donde corre (en Mac: .app/.dmg)
```

## Notas

- La partida se guarda sola dentro de la aplicación, igual que en el navegador. «Guardar» descarga un `.json`.
- El ícono sale de un tile del *1-Bit Pack* de Kenney (CC0). Para regenerarlo: `npm run desktop:icon`.
