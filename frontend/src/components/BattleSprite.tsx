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
}: {
  src: string;
  label: string;
  frame?: number;
  backdrop?: boolean;
  className?: string;
  filter?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    void load(src)
      .then((image) => {
        if (!active || !canvas.current) return;
        const context = canvas.current.getContext("2d")!;
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
                  !src.endsWith("446-578.png"),
                ),
              );
            source =
              sheets.get(src)![Math.min((attackFrames[src]?.length ?? 1) - 1, Math.max(0, frame))];
            width = pose[2];
            height = pose[3];
          }
        } else if (backdrop) {
          // Art-card whitespace is outside the character's gameplay box.
          const pixels = (source as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(0, 0, width, height).data;
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
        context.clearRect(0, 0, 160, 120);
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
        draw();
      })
      .catch(() => {
        /* Keep the accessible label when an asset cannot load. */
      });
    return () => {
      active = false;
    };
  }, [src, frame, backdrop]);
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
      style={{ filter }}
    />
  );
}
