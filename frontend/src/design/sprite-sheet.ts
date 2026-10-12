import type { SpriteFrame } from "./battle-assets";

// The Brachiosaurus poses overlap horizontally (tails sit below a neighboring
// neck). Separate connected character silhouettes before applying frame boxes.
// This removes neighboring body fragments without cutting the selected pose.
export function prepareAttackFrames(
  image: HTMLImageElement,
  frames: readonly SpriteFrame[],
  darkBackdrop = false,
  isolateBodies = true,
) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = pixels;
  // The new Pteranodon sheet has an opaque black background. Flood from the
  // outer edge only so black eyes and enclosed outlines remain in each pose.
  if (darkBackdrop) {
    const visited = new Uint8Array(width * height);
    const pending = new Int32Array(width * height);
    let head = 0,
      tail = 0;
    const add = (i: number) => {
      if (i < 0 || i >= visited.length || visited[i]) return;
      visited[i] = 1;
      if (Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) <= 24) pending[tail++] = i;
    };
    for (let x = 0; x < width; x++) {
      add(x);
      add((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      add(y * width);
      add(y * width + width - 1);
    }
    while (head < tail) {
      const i = pending[head++];
      data[i * 4 + 3] = 0;
      if (i % width) add(i - 1);
      if (i % width < width - 1) add(i + 1);
      add(i - width);
      add(i + width);
    }
    context.putImageData(pixels, 0, 0);
  }
  if (!isolateBodies)
    return frames.map(([x, y, width, height]) => {
      const frame = document.createElement("canvas");
      frame.width = width;
      frame.height = height;
      frame.getContext("2d")!.drawImage(canvas, x, y, width, height, 0, 0, width, height);
      return frame;
    });
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  const components: { label: number; size: number; x: number }[] = [];
  let label = 0;
  for (let seed = 0; seed < labels.length; seed++) {
    if (labels[seed] || data[seed * 4 + 3] <= 40) continue;
    label++;
    let head = 0,
      tail = 1,
      minX = width;
    queue[0] = seed;
    labels[seed] = label;
    while (head < tail) {
      const pixel = queue[head++],
        x = pixel % width,
        y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
          const next = pixel + dy * width + dx;
          if (!labels[next] && data[next * 4 + 3] > 40) {
            labels[next] = label;
            queue[tail++] = next;
          }
        }
    }
    components.push({ label, size: tail, x: minX });
  }
  const bodies = components
    .sort((a, b) => b.size - a.size)
    .slice(0, frames.length)
    .sort((a, b) => a.x - b.x);
  const bodyLabels = new Set(bodies.map((body) => body.label));
  return frames.map(([x, y, w, h], index) => {
    const frame = document.createElement("canvas");
    frame.width = w;
    frame.height = h;
    const output = frame.getContext("2d")!;
    output.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    const pixels = output.getImageData(0, 0, w, h);
    for (let row = 0; row < h; row++)
      for (let col = 0; col < w; col++) {
        const owner = labels[(y + row) * width + x + col];
        if (bodyLabels.has(owner) && owner !== bodies[index]?.label)
          pixels.data[(row * w + col) * 4 + 3] = 0;
      }
    output.putImageData(pixels, 0, 0);
    return frame;
  });
}
