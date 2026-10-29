import { z } from "zod";
import type { Detection } from "@mediapipe/tasks-vision";

export const toolLabels = ["pill", "insulin_pen", "syringe"] as const;
export type ToolLabel = (typeof toolLabels)[number];
export type ToolEvidence = {
  modelReady: boolean;
  observedAt: number;
  items: { label: ToolLabel; score: number; x: number; y: number; width: number; height: number }[];
};
export const toolManifestSchema = z.object({
  schemaVersion: z.literal(1),
  validated: z.literal(true),
  file: z.string().regex(/^tool-[a-zA-Z0-9_.-]+\.tflite$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  labels: z.tuple([z.literal("pill"), z.literal("insulin_pen"), z.literal("syringe")]),
  evaluation: z.object({
    trainSubjects: z.number().int().min(2),
    evaluationSubjects: z.number().int().min(1),
    images: z.number().int().min(20),
    AP: z.number().min(0.5).max(1),
  }),
});

/** Inactive until a separately evaluated, metadata-bearing TFLite is supplied. */
export async function loadToolModel(base: string) {
  const response = await fetch(`${base}/models/motion-capture/tool-model.json`);
  if (!response.ok) throw new Error("Tool manifest unavailable");
  const raw: unknown = await response.json();
  if (raw && typeof raw === "object" && "validated" in raw && raw.validated === false) return null;
  const manifest = toolManifestSchema.parse(raw);
  const model = await fetch(`${base}/models/motion-capture/${manifest.file}`);
  if (!model.ok) throw new Error("Tool model unavailable");
  const bytes = new Uint8Array(await model.arrayBuffer());
  if (bytes.byteLength > 20_000_000) throw new Error("Tool model exceeds limit");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== manifest.sha256) throw new Error("Tool model checksum mismatch");
  return bytes;
}

export function toolEvidence(
  detections: Detection[],
  timestamp: number,
  width: number,
  height: number,
  modelReady: boolean,
): ToolEvidence {
  return {
    modelReady,
    observedAt: timestamp,
    items: detections.flatMap((d) => {
      const category = d.categories.find((c) => toolLabels.includes(c.categoryName as ToolLabel));
      const box = d.boundingBox;
      if (!box || !category) return [];
      return [
        {
          label: category.categoryName as ToolLabel,
          score: category.score,
          x: box.originX / width,
          y: box.originY / height,
          width: box.width / width,
          height: box.height / height,
        },
      ];
    }),
  };
}
