# Ilustraciones de la interfaz

- `source/ui-assets-atlas.png`: lámina fuente (1254×1254, RGBA, grilla 4×4) **generada con IA para este proyecto**. No es parte del 1-Bit Pack de Kenney y no lleva su licencia.
- `source/assets-manifest.json`: id de juego, nombre de archivo y celda de cada ilustración (índices desde cero).
- `source/referencia-ui.png`: boceto de la dirección visual. Sus números y textos no son reglas.
- `illustrations/*.png`: los 16 recortes que usa la interfaz.

Se regeneran con:

```bash
python3 scripts/extract-ui-illustrations.py
```

El script limpia el ruido de alfa de las canaletas (umbral del manifest), verifica que ningún contenido toque el borde de su celda (recorte o arte vecino) y copia cada ilustración **sin re-escalar**, centrada en un lienzo transparente común de 252×252. La interfaz las muestra a 63, 84 o 126 px (divisores exactos) con `image-rendering: pixelated`.

Son solo para paneles: los mapas siguen usando el tileset de Kenney y los tiles propios de `data/tiles-extra.json`. La de «distribución» se reutiliza para Menudeo y Corrida de armas; la de la sede no corresponde a ningún negocio construible.
