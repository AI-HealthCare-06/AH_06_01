import {isDeepStrictEqual} from "node:util";

export function preserveExistingResources(previous,next){
  const result=structuredClone(next);
  for(const [id,old] of Object.entries(previous.Resources)){
    const current=result.Resources[id];
    if(!current) throw new Error(`Existing resource removed: ${id}`);
    const {Metadata:oldMetadata,...oldBehavior}=old;
    const {Metadata:newMetadata,...newBehavior}=current;
    if(!isDeepStrictEqual(oldBehavior,newBehavior)) throw new Error(`Unexpected existing resource change: ${id}`);
    // CDK path metadata is not a reason to update the collector, its role, or
    // invoke permissions. Retain the complete existing resource definition.
    result.Resources[id]=structuredClone(old);
  }
  return result;
}

export function assertSafeModelChanges(changes){
  const model=changes.find(c=>c.LogicalResourceId==="BpStage337FBFBD");
  const codeOnly=model?.Action==="Modify" && model.Replacement==="False" &&
    model.Details?.length>0 && model.Details.every(d=>d.Target?.Name==="Code" && d.Target.RequiresRecreation==="Never");
  for(const change of changes){
    if(change.Action==="Remove" || change.Replacement==="True") throw new Error("Unsafe resource replacement/removal");
    if(change.Replacement!=="Conditional") continue;
    // CFN conservatively propagates an in-place code update through GetAtt Arn.
    // The function is not replaced, the complete permission properties were
    // preserved above, and the API caller/source scope stays exactly the same.
    const sameModelPermission=codeOnly && change.Action==="Modify" &&
      change.ResourceType==="AWS::Lambda::Permission" && change.LogicalResourceId.includes("BpStageIntegrationPermission") &&
      change.Details?.length>0 && change.Details.every(d=>d.Evaluation==="Dynamic" &&
        d.ChangeSource==="ResourceAttribute" && d.CausingEntity==="BpStage337FBFBD.Arn" && d.Target?.Name==="FunctionName");
    if(!sameModelPermission) throw new Error("Unexpected conditional replacement");
  }
}
