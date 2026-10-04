import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {createRegistry} from '@interactive-project/registry';
import {createGenerationCatalog} from '@interactive-project/registry/catalog';
import {validateEngineManifest,validateRendererManifest} from '@interactive-project/registry/validation';
import {validateGeneratedActivity} from '@interactive-project/protocol/generation';
import {validateActivitySpec} from '@interactive-project/protocol/validation';
import {validateAction,validateResult,validateSnapshot} from '@interactive-project/protocol/validation/interoperability';
import {validateEvent} from '@interactive-project/events/validation';
import {createQuizEngine} from '../engine/index.js';
import {createLocalEvaluator} from '../evaluation/index.js';
import {toLearnerQuiz} from '../index.js';
import {validateAuthorQuiz,validateLearnerQuiz,validateQuizResponse} from '../validation/index.js';
import {loadActivity} from '@interactive-project/core/loading';

const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const author=read('fixtures/single-choice.valid.json');
const manifest=read('manifests/quiz-practice.v1.json');
const hostTrace=read('fixtures/host-conformance.v1.json');
const learner=toLearnerQuiz(author,validateAuthorQuiz);
const activity={protocolVersion:'1.0.0',id:uuid(1),type:'interactive-project/quiz',activitySchemaVersion:'1.0.0',metadata:{title:'Generated Quiz conformance'},config:learner};
const validators={activity:validateActivitySpec,learner:validateLearnerQuiz,response:validateQuizResponse,action:validateAction,result:validateResult,snapshot:validateSnapshot,event:validateEvent};
const evaluator=createLocalEvaluator({author,validateAuthor:validateAuthorQuiz,validateResponse:validateQuizResponse});
const validSemantics=()=>({valid:true,requirements:{permissions:[],capabilities:['interactive','evaluable']}});
assert.deepEqual(manifest.protocolVersions,['1.0.0']);
assert.equal(manifest.pluginVersion,'0.1.0');
assert.equal(manifest.entries[0].activitySchemaVersion,'1.0.0');
assert.equal(manifest.entries[0].schemaId,'https://github.com/interactive-project/quiz/blob/main/schemas/quiz.v1.schema.json#/$defs/learner');
assert.deepEqual([...manifest.entries[0].requiredCapabilities].sort(),['evaluable','interactive']);
assert.equal(manifest.entries[0].capabilities.evaluable.supported,true);
assert.equal(manifest.entries[0].capabilities.offline.supported,true,'the declared practice evaluator is local');
assert.deepEqual(manifest.entries[0].requiredPermissions,[]);

function register(manifestValue=manifest){
 const registry=createRegistry({validateEngineManifest,validateRendererManifest}),factoryCalls={value:0};
 assert(registry.registerEngine(manifestValue,{
  createEngine:(spec,context)=>{
   factoryCalls.value++;
   const number=factoryCalls.value;let next=20000+number*1000;
   return createQuizEngine({activity:spec,sessionId:context.sessionId,attemptId:context.attemptId,sourceId:uuid(80+number),signal:context.signal,validators,clock:()=>1700000000000,nextId:()=>uuid(next++),evaluate:frame=>evaluator.evaluate(frame)},webcrypto);
  },
  evaluate:session=>session.evaluate()
 }).registered);
 return{registry,factoryCalls};
}
function loaderOptions(registry,catalog,{policy={},validateDomainSemantics=validSemantics}={}){
 return{registry,catalog,generated:true,policy,availableDrivers:[],engineContext:{sessionId:uuid(2),attemptId:uuid(3)},validateDomainSchema:validateLearnerQuiz,validateDomainSemantics};
}
function generationContext(catalog,{policy={},validateDomainSemantics=validSemantics}={}){
 return{catalog,policy,availableDrivers:[],validateDomainSchema:validateLearnerQuiz,validateDomainSemantics};
}

const registered=register();
const catalogResult=createGenerationCatalog(registered.registry);
assert(catalogResult.valid);
const catalog=catalogResult.catalog;
assert.equal(catalog.entries[0].schemaId,manifest.entries[0].schemaId);
const generated=validateGeneratedActivity(JSON.stringify(activity),generationContext(catalog));
assert(generated.valid,JSON.stringify(generated));
assert.equal(generated.stage,'accepted');
assert(!JSON.stringify(generated.activity).includes(JSON.stringify(author.solutions)));

let loaded=await loadActivity(generated.activity,loaderOptions(registered.registry,catalog));
assert(loaded.loaded,JSON.stringify(loaded));
assert.equal(loaded.engine.getState().phase,'ready','Core must validate before any start action');
assert.equal(registered.factoryCalls.value,1);
const events=[];
loaded.engine.subscribeEvents(event=>{
 assert(validateEvent(event).valid,JSON.stringify(event));
 events.push(event.type);
},{replay:true});
let actionId=90000;
for(const step of hostTrace.actionTrace){
 if(step.await==='evaluation'){
  await loaded.engine.whenEvaluationSettled();
  continue;
 }
 const payload=step.payloadFixture?{response:read(step.payloadFixture)}:step.payload;
 const action={protocolVersion:'1.0.0',actionVersion:'1.0.0',id:uuid(actionId++),activityId:activity.id,sessionId:uuid(2),attemptId:loaded.engine.getContext().attemptId,sequence:loaded.engine.getState().actionSequence,type:'interactive-project/quiz.'+step.action,payload};
 const result=loaded.engine.dispatch(action);
 assert.equal(result.status,'accepted',step.action+': '+JSON.stringify(result));
}
const result=loaded.engine.evaluate();
assert(validateResult(result,{activityId:activity.id,sessionId:uuid(2),attemptId:uuid(3)}).valid);
assert.equal(result.status,hostTrace.expected.resultStatus);
assert.equal(result.score.value,hostTrace.expected.score);
assert.deepEqual(events,hostTrace.expected.eventTypes,'headless golden event trace');
const snapshot=loaded.engine.serialize();
assert(validateSnapshot(snapshot,{activityId:activity.id,activityType:activity.type,activitySchemaVersion:activity.activitySchemaVersion,sessionId:uuid(2),attemptId:uuid(3)}).valid);
const snapshotText=JSON.stringify(snapshot);
assert(!snapshotText.includes(JSON.stringify(author.solutions)));
loaded.dispose();

const restored=await loadActivity(generated.activity,loaderOptions(registered.registry,catalog));
assert(restored.loaded,JSON.stringify(restored));
const restoreEvents=[];
restored.engine.subscribeEvents(event=>restoreEvents.push(event.type),{replay:true});
restored.engine.restore(JSON.parse(snapshotText));
assert.deepEqual(restored.engine.getState(),snapshot.state);
assert(restoreEvents.includes('interactive-project/activity.resumed'));
restored.dispose();
assert.equal(registered.factoryCalls.value,2);

async function rejectsBeforeFactory({input=activity,useCatalog=catalog,semantic=validSemantics,policy={},code,protocolStage,coreStage}){
 const callsBefore=registered.factoryCalls.value;
 const checked=validateGeneratedActivity(input,generationContext(useCatalog,{policy,validateDomainSemantics:semantic}));
 assert(!checked.valid);
 assert.equal(checked.diagnostics[0].code,code);
 assert.equal(checked.stage,protocolStage);
 const outcome=await loadActivity(input,loaderOptions(registered.registry,useCatalog,{policy,validateDomainSemantics:semantic}));
 assert(!outcome.loaded);
 assert.equal(outcome.stage,coreStage);
 assert.equal(registered.factoryCalls.value,callsBefore,'rejected generated activity must not construct an engine');
}

const structurallyInvalid={...activity,config:{...activity.config,questions:[]}};
await rejectsBeforeFactory({input:structurallyInvalid,code:'generation.domainSchema',protocolStage:'structural',coreStage:'structural'});
const falseSemantics=()=>({valid:false,requirements:{permissions:[],capabilities:['interactive','evaluable']}});
await rejectsBeforeFactory({semantic:falseSemantics,code:'generation.semantic',protocolStage:'semantic',coreStage:'semantic'});

const restricted=createGenerationCatalog(registered.registry,{allowedCapabilities:['interactive','evaluable','offline','deterministic','resumable']});
assert(restricted.valid);
await rejectsBeforeFactory({useCatalog:restricted.catalog,code:'generation.capability',protocolStage:'capability',coreStage:'capability'});

const executionManifest=structuredClone(manifest);
executionManifest.id='interactive-project/quiz-execution-probe';
executionManifest.entries[0].requiredPermissions=['execution'];
const permissionProbe=register(executionManifest);
const executionCatalog=createGenerationCatalog(permissionProbe.registry,{policy:{execution:true}});
assert(executionCatalog.valid);
const permissionValidation=validateGeneratedActivity(activity,generationContext(executionCatalog.catalog,{policy:{}}));
assert(!permissionValidation.valid);
assert.equal(permissionValidation.diagnostics[0].code,'generation.permissionDenied');
assert.equal(permissionValidation.stage,'permission');
const denied=await loadActivity(activity,loaderOptions(permissionProbe.registry,executionCatalog.catalog,{policy:{}}));
assert(!denied.loaded);
assert.equal(denied.stage,'permission');
assert.equal(permissionProbe.factoryCalls.value,0,'permission denial must precede the engine factory');
permissionProbe.registry.dispose();
registered.registry.dispose();
console.log('Quiz generation gates: valid Catalog → Protocol Quiz validation → Core load → answer/evaluate/events/snapshot/restore; structural, semantic, execution-permission and aiGeneratable denials all precede engine construction.');
