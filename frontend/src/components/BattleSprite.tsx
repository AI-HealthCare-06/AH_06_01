import { useEffect, useRef } from "react";
import { attackFrames } from "../design/battle-assets";
import { prepareAttackFrames } from "../design/sprite-sheet";

const images = new Map<string, Promise<HTMLImageElement>>();
function load(src: string) {
  if (!images.has(src))
    images.set(
      src,
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      }),
    );
  return images.get(src)!;
}
const cutouts = new Map<string, HTMLCanvasElement>();
const sheets = new Map<string, HTMLCanvasElement[]>();
const visibleBounds = new WeakMap<HTMLCanvasElement, [number, number, number, number]>();
function alphaBounds(canvas: HTMLCanvasElement) {
  const cached = visibleBounds.get(canvas);
  if (cached) return cached;
  const { width, height } = canvas;
  const data = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++)
      if (data[(row * width + col) * 4 + 3] > 128) {
        left = Math.min(left, col);
        top = Math.min(top, row);
        right = Math.max(right, col);
        bottom = Math.max(bottom, row);
      }
  const bounds: [number, number, number, number] = [left, top, right - left + 1, bottom - top + 1];
  visibleBounds.set(canvas, bounds);
  return bounds;
}

// Concept art has an opaque white backdrop. Remove only edge-connected backdrop pixels
// while rendering; enclosed white eyes/highlights and the original source file stay intact.
function silhouette(image: HTMLImageElement, src: string) {
  if (cutouts.has(src)) return cutouts.get(src)!;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = pixels;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0,
    tail = 0;
  const add = (i: number) => {
    if (i < 0 || i >= visited.length || visited[i]) return;
    visited[i] = 1;
    const p = i * 4;
    if (
      Math.min(data[p], data[p + 1], data[p + 2]) >= 230 &&
      Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]) < 30
    )
      queue[tail++] = i;
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
    const i = queue[head++];
    data[i * 4 + 3] = 0;
    if (i % width) add(i - 1);
    if (i % width < width - 1) add(i + 1);
    add(i - width);
    add(i + width);
  }
  context.putImageData(pixels, 0, 0);
  cutouts.set(src, canvas);
  return canvas;
}

export function BattleSprite({
  src,
  label,
  frame,
  backdrop = false,
  className = "",
  filter,
  matchBounds,
}: {
  src: string;
  label: string;
  frame?: number;
  backdrop?: boolean;
  className?: string;
  filter?: string;
  matchBounds?: readonly [number, number, number, number];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    void load(src)
      .then((image) => {
        if (!active || !canvas.current) return;
        const buffer = document.createElement("canvas");
        const padX = matchBounds ? 160 : 0,
          padY = matchBounds ? 120 : 0;
        buffer.width = matchBounds ? 480 : 160;
        buffer.height = matchBounds ? 360 : 120;
        const context = buffer.getContext("2d")!;
        let source: HTMLImageElement | HTMLCanvasElement = backdrop
          ? silhouette(image, src)
          : image;
        let x = 0,
          y = 0,
          width = image.naturalWidth,
          height = image.naturalHeight;
        if (frame !== undefined) {
          const pose =
            attackFrames[src]?.[Math.min((attackFrames[src]?.length ?? 1) - 1, Math.max(0, frame))];
          if (pose) {
            if (!sheets.has(src))
              sheets.set(
                src,
                prepareAttackFrames(
                  image,
                  attackFrames[src],
                  /434-578|446-578/.test(src),
                  !/446-578|Spritesheet|Melee|Ranged|Dino/.test(src),
                ),
              );
            source =
              sheets.get(src)![Math.min((attackFrames[src]?.length ?? 1) - 1, Math.max(0, frame))];
            width = pose[2];
            height = pose[3];
          }
        } else {
          // Art-card whitespace is outside the character's gameplay box.
          const boundsCanvas = document.createElement("canvas");
          boundsCanvas.width = width;
          boundsCanvas.height = height;
          const boundsContext = boundsCanvas.getContext("2d")!;
          boundsContext.drawImage(source, 0, 0);
          const pixels = boundsContext.getImageData(0, 0, width, height).data;
          let left = width,
            top = height,
            right = 0,
            bottom = 0;
          for (let row = 0; row < height; row++)
            for (let col = 0; col < width; col++)
              if (pixels[(row * width + col) * 4 + 3] > 128) {
                left = Math.min(left, col);
                right = Math.max(right, col);
                top = Math.min(top, row);
                bottom = Math.max(bottom, row);
              }
          if (right > left) {
            x = left;
            y = top;
            width = right - left + 1;
            height = bottom - top + 1;
          }
        }
        const poses = frame === undefined ? undefined : attackFrames[src];
        const scale = Math.min(
          160 / (poses ? Math.max(...poses.map((p) => p[2])) : width),
          120 / (poses ? Math.max(...poses.map((p) => p[3])) : height),
        );
        context.clearRect(0, 0, buffer.width, buffer.height);
        context.imageSmoothingEnabled = false;
        const draw = () =>
          context.drawImage(
            source,
            x,
            y,
            width,
            height,
            Math.round((160 - width * scale) / 2),
            Math.round(120 - height * scale),
            Math.round(width * scale),
            Math.round(height * scale),
          );
        if (matchBounds && source instanceof HTMLCanvasElement && sheets.has(src)) {
          // Calibrate the character body from the first pose, independently of
          // attack effects or extended horns/tails in later poses. Keep one scale
          // for the whole motion and share IDLE's center and foot/hover anchor.
          const [, , baseWidth, baseHeight] = alphaBounds(sheets.get(src)![0]);
          const [px, py, pw, ph] = alphaBounds(source);
          const width = Math.round((pw * matchBounds[2]) / baseWidth),
            height = Math.round((ph * matchBounds[3]) / baseHeight);
          context.drawImage(
            source,
            px,
            py,
            pw,
            ph,
            padX + Math.round(matchBounds[0] + matchBounds[2] / 2 - width / 2),
            padY + matchBounds[1] + matchBounds[3] - height,
            width,
            height,
          );
        } else draw();
        const pixels = context.getImageData(0, 0, buffer.width, buffer.height).data;
        let left = buffer.width,
          top = buffer.height,
          right = -1,
          bottom = -1;
        for (let row = 0; row < buffer.height; row++)
          for (let col = 0; col < buffer.width; col++) {
            if (pixels[(row * buffer.width + col) * 4 + 3] > 0) {
              left = Math.min(left, col);
              right = Math.max(right, col);
              top = Math.min(top, row);
              bottom = Math.max(bottom, row);
            }
          }
        if (right < left) return;
        const output = canvas.current;
        output.width = right - left + 1;
        output.height = bottom - top + 1;
        output.style.left = `${((left - padX) / 160) * 100}%`;
        output.style.top = `${((top - padY) / 120) * 100}%`;
        output.style.width = `${(output.width / 160) * 100}%`;
        output.style.height = `${(output.height / 120) * 100}%`;
        const cropped = output.getContext("2d")!;
        cropped.imageSmoothingEnabled = false;
        cropped.drawImage(
          buffer,
          left,
          top,
          output.width,
          output.height,
          0,
          0,
          output.width,
          output.height,
        );
        output.dataset.renderedSrc = src;
        output.dataset.renderedFrame = String(frame ?? "");
      })
      .catch(() => {
        /* Keep the accessible label when an asset cannot load. */
      });
    return () => {
      active = false;
    };
  }, [src, frame, backdrop, matchBounds]);
  return (
    <canvas
      ref={canvas}
      width={160}
      height={120}
      className={`battle-sprite ${className}`}
      role="img"
      aria-label={label}
      data-src={src}
      data-frame={frame}
      data-size-reference={matchBounds ? "idle" : undefined}
      style={{ filter }}
    />
  );
}
