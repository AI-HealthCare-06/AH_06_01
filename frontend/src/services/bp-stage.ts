import { cloudApi } from "../cloud/client";
import { bpStageSchema } from "../domain/bp-stage";

export async function loadBpStage(userId: string) {
  const result = await cloudApi<unknown>("/v1/predictions/bp-stage", {}, userId);
  return bpStageSchema.parse(result);
}
