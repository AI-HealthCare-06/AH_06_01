import {test} from "node:test";
import assert from "node:assert/strict";
import {preserveExistingResources,assertSafeModelChanges} from "./plan.mjs";
const previous={Resources:{Existing:{Type:"AWS::Lambda::Function",Properties:{Handler:"index.handler"},Metadata:{path:"original"}}}};
test("metadata-only CDK drift does not modify an existing collector or permission",()=>{
  const next=structuredClone(previous);next.Resources.Existing.Metadata.path="new";
  next.Resources.Model={Type:"AWS::Lambda::Function",Properties:{Handler:"handler.handler"}};
  const result=preserveExistingResources(previous,next);
  assert.deepEqual(result.Resources.Existing,previous.Resources.Existing);
  assert.deepEqual(result.Resources.Model,next.Resources.Model);
});
test("only an unchanged model invoke permission may follow an in-place code update",()=>{
  const model={LogicalResourceId:"BpStage337FBFBD",ResourceType:"AWS::Lambda::Function",Action:"Modify",Replacement:"False",
    Details:[{Target:{Name:"Code",RequiresRecreation:"Never"}}]};
  const permission={LogicalResourceId:"ApiPOSTBpStageIntegrationPermission",ResourceType:"AWS::Lambda::Permission",Action:"Modify",Replacement:"Conditional",
    Details:[{Evaluation:"Dynamic",ChangeSource:"ResourceAttribute",CausingEntity:"BpStage337FBFBD.Arn",Target:{Name:"FunctionName"}}]};
  assert.doesNotThrow(()=>assertSafeModelChanges([model,permission]));
  assert.throws(()=>assertSafeModelChanges([model,{...permission,LogicalResourceId:"CollectorPermission"}]));
  assert.throws(()=>assertSafeModelChanges([{...model,Replacement:"True"},permission]));
});
test("unrelated replacement, behavior change or removal fails before deployment",()=>{
  const next=structuredClone(previous);next.Resources.Existing.Properties.Handler="unexpected.handler";
  assert.throws(()=>preserveExistingResources(previous,next),/Unexpected/);
  assert.throws(()=>preserveExistingResources(previous,{Resources:{}}),/removed/);
});
