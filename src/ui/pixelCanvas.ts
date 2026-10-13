// Draws a grid of colors (patches, portraits) on a <canvas>, scaled with crisp pixels.

export function pixelCanvas(pixels: (string | null)[][] | null, size: number, scale: number, className: string, title = ""): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = `${size * scale}px`;
  canvas.style.height = `${size * scale}px`;
  canvas.style.imageRendering = "pixelated";
  canvas.className = className;
  if (title) canvas.title = title;
  const ctx = canvas.getContext("2d");
  if (!ctx || !pixels) return canvas;
  pixels.forEach((row, y) =>
    row.forEach((color, x) => {
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return canvas;
}
