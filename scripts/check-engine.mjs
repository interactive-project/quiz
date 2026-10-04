import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {createQuizEngine} from '../engine/index.js';
import {createLocalEvaluator} from '../evaluation/index.js';
import {toLearnerQuiz} from '../index.js';
import {validateAuthorQuiz,validateLearnerQuiz,validateQuizResponse} from '../validation/index.js';
import {validateActivitySpec} from '@interactive-project/protocol/validation';
import {validateAction,validateResult,validateSnapshot} from '@interactive-project/protocol/validation/interoperability';
import {validateEvent} from '@interactive-project/events/validation';
import {createRegistry} from '@interactive-project/registry';
import {validateEngineManifest,validateRendererManifest} from '@interactive-project/registry/validation';
import {loadActivity} from '@interactive-project/core/loading';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url))),clone=v=>JSON.parse(JSON.stringify(v));
const author=read('fixtures/single-choice.valid.json'),validators={activity:validateActivitySpec,learner:validateLearnerQuiz,response:validateQuizResponse,action:validateAction,result:validateResult,snapshot:validateSnapshot,event:validateEvent};
const local=a=>createLocalEvaluator({author:a,validateAuthor:validateAuthorQuiz,validateResponse:validateQuizResponse});
let actionId=50000;
async function fixture(extra={}){
 let next=1000,time=100;
 const a=extra.author??author,learner=toLearnerQuiz(a,validateAuthorQuiz),evaluator=local(a),activity={protocolVersion:'1.0.0',id:uuid(1),type:'interactive-project/quiz',activitySchemaVersion:'1.0.0',metadata:{title:'Quiz engine fixture'},config:learner};
 const options={activity,sessionId:uuid(2),attemptId:uuid(3),sourceId:uuid(4),validators,clock:()=>time,nextId:()=>uuid(next++),evaluate:f=>evaluator.evaluate(f),...extra};delete options.author;
 const engine=await createQuizEngine(options,webcrypto),events=[];engine.subscribeEvents(e=>{assert(validateEvent(e).valid);events.push(e);},{replay:true});
 const action=(kind,payload={})=>({protocolVersion:'1.0.0',actionVersion:'1.0.0',id:uuid(actionId++),activityId:uuid(1),sessionId:uuid(2),attemptId:engine.getContext().attemptId,sequence:engine.getState().actionSequence,type:'interactive-project/quiz.'+kind,payload});
 const dispatch=(kind,payload={})=>engine.dispatch(action(kind,payload));
 return{engine,options,activity,events,action,dispatch,setTime:v=>time=v};
}
const response=read('fixtures/single-choice.response.json');
{
 const f=await fixture({policy:{maxAttempts:2,feedback:'after-complete'}});
 assert.equal(f.dispatch('answer',{response}).status,'rejected');assert.equal(f.dispatch('start').status,'accepted');const changed=f.action('answer',{response});assert.equal(f.engine.dispatch(changed).status,'accepted');assert.equal(f.engine.dispatch(changed).code,'action.stale');
 assert.equal(f.dispatch('submit').status,'accepted');assert.equal(f.dispatch('submit').status,'rejected');await f.engine.whenEvaluationSettled();assert.equal(f.engine.getState().phase,'feedback');assert.equal(f.engine.evaluate().score.value,1);assert.equal(f.engine.getFeedback(),null);assert(!Object.hasOwn(f.engine.getState(),'result'));
 const oldAttempt=f.engine.getContext().attemptId;assert.equal(f.dispatch('review').status,'accepted');assert.equal(f.dispatch('retry').status,'accepted');assert.notEqual(f.engine.getContext().attemptId,oldAttempt);assert.equal(f.engine.getState().attemptNumber,2);assert.equal(f.engine.evaluate().status,'pending');assert(!Object.hasOwn(f.engine.serialize().state,'result'));
 assert.equal(f.engine.dispatch({...f.action('answer',{response}),attemptId:oldAttempt}).code,'action.identity');
 f.dispatch('answer',{response});f.dispatch('submit');await f.engine.whenEvaluationSettled();assert.equal(f.dispatch('retry').status,'rejected');f.dispatch('complete');assert.equal(f.engine.getState().lifecycle,'completed');assert.equal(f.engine.getFeedback().score.value,1);
 assert.equal(f.events.filter(e=>e.type==='interactive-project/attempt.started').length,2);assert.equal(f.events.filter(e=>e.type==='interactive-project/attempt.submitted').length,2);assert.equal(f.events.filter(e=>e.type==='interactive-project/answer.changed').length,2);assert.equal(f.events.filter(e=>e.type==='interactive-project/activity.completed').length,1);assert.deepEqual(f.events.map(e=>e.sequence),f.events.map((_,i)=>i));f.engine.dispose();
}
{
 const a=clone(author);const second=clone(a.questions[0]);second.id='q2';a.questions.push(second);a.solutions.q2={kind:'single-choice',answer:'b'};
 const f=await fixture({author:a,policy:{navigation:'linear',hints:'during'}});
 f.dispatch('start');assert.equal(f.dispatch('answer',{response:{...response,questionId:'q2'}}).status,'rejected');assert.equal(f.dispatch('navigate',{questionId:'q2'}).status,'rejected');f.dispatch('hint',{questionId:'q1'});assert.equal(f.dispatch('hint',{questionId:'q1'}).status,'rejected');
 assert.equal(f.dispatch('skip').status,'accepted');assert.equal(f.engine.getState().index,1);assert.equal(f.dispatch('submit').status,'rejected');f.dispatch('answer',{response:{...response,questionId:'q2',answer:'b'}});
 const snapshot=f.engine.serialize(),restored=await fixture({author:a,policy:{navigation:'linear',hints:'during'},sourceId:uuid(9)});restored.engine.restore(JSON.parse(JSON.stringify(snapshot)));assert.deepEqual(restored.engine.getState(),f.engine.getState());assert.equal(restored.engine.getContext().revision,f.engine.getContext().revision);
 const before=restored.engine.getState(),bad=clone(snapshot);bad.state.responses.q2.questionId='unknown';assert.throws(()=>restored.engine.restore(bad),e=>e.code==='quiz.snapshot');assert.deepEqual(restored.engine.getState(),before);
 assert.equal(restored.events.at(-1).type,'interactive-project/activity.resumed');f.engine.dispose();restored.engine.dispose();
}
{
 const kinds=['single-choice','multiple-choice','true-false','numeric','short-answer','fill-blank','matching','ordering'];
 for(let index=0;index<kinds.length;index++){
  const kind=kinds[index],a=read(`fixtures/${kind}.valid.json`),answer=read(`fixtures/${kind}.response.json`);
  const f=await fixture({author:a});
  assert.equal(f.dispatch('start').status,'accepted',kind);
  assert.equal(f.dispatch('answer',{response:answer}).status,'accepted',kind);
  const snapshot=f.engine.serialize();
  assert(validateSnapshot(snapshot).valid,kind+' snapshot');
  const resumed=await fixture({author:a,sourceId:uuid(20+index)});
  resumed.engine.restore(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(resumed.engine.getState(),f.engine.getState(),kind+' round trip');
  assert.equal(resumed.events.at(-1).type,'interactive-project/activity.resumed',kind);
  const before=resumed.engine.getState();
  for(const mutate of [
   value=>{value.protocolVersion='9.0.0';},
   value=>{value.snapshotVersion='9.0.0';},
   value=>{value.activity.activitySchemaVersion='9.0.0';},
   value=>{value.engine.stateVersion='9.0.0';},
   value=>{value.activity.contentDigest='0'.repeat(64);},
   value=>{value.session.id=uuid(999);},
   value=>{value.drivers={'fixtures/unapproved':{state:{native:true}}};}
  ]){
   const incompatible=clone(snapshot);mutate(incompatible);
   assert.throws(()=>resumed.engine.restore(incompatible),error=>error.code==='quiz.snapshot',kind+' incompatible version/digest');
   assert.deepEqual(resumed.engine.getState(),before,kind+' failed restore must be atomic');
  }
  f.engine.dispose();resumed.engine.dispose();
 }
}
{
 const f=await fixture({policy:{timeLimitMs:10,allowUnanswered:true}});f.dispatch('start');f.setTime(109);assert.equal(f.dispatch('answer',{response}).status,'accepted');f.setTime(110);assert.equal(f.dispatch('answer',{response}).status,'rejected');assert.equal(f.dispatch('submit').status,'rejected');assert.equal(f.dispatch('timeout').status,'accepted');assert.equal(f.engine.evaluate().failure.code,'evaluation.timeout');assert(!Object.hasOwn(f.engine.evaluate(),'score'));f.engine.dispose();
}
{
 let resolve,calls=0;
 const f=await fixture({policy:{allowUnanswered:true,maxAttempts:2},evaluate:frame=>{calls++;return new Promise(r=>resolve=()=>r(local(author).evaluate(frame)));}});
 f.dispatch('start');f.dispatch('submit');await new Promise(r=>setImmediate(r));const snapshot=f.engine.serialize();f.engine.restore(snapshot);assert.equal(f.engine.getState().phase,'feedback');assert.equal(f.engine.evaluate().failure.code,'evaluation.cancelled');resolve();await new Promise(r=>setImmediate(r));assert.equal(f.engine.evaluate().failure.code,'evaluation.cancelled');assert.equal(calls,1);assert.equal(f.dispatch('retry').status,'accepted');f.engine.dispose();
}
{
 const hidden=read('fixtures/short-answer.valid.json');hidden.solutions.q5.accepted=['SERVER_SOLUTION_SECRET'];
 const f=await fixture({author:hidden,policy:{hints:'never'}});f.dispatch('start');assert.equal(f.dispatch('hint',{questionId:'q5'}).status,'rejected');f.dispatch('answer',{response:{questionId:'q5',kind:'short-answer',answer:'LEARNER_TYPED_SECRET'}});
 assert(!JSON.stringify(f.activity).includes('SERVER_SOLUTION_SECRET'));assert(!JSON.stringify(f.engine.serialize()).includes('SERVER_SOLUTION_SECRET'));assert(!JSON.stringify(f.events).includes('SERVER_SOLUTION_SECRET'));assert(!JSON.stringify(f.events).includes('LEARNER_TYPED_SECRET'));f.engine.dispose();
}
{
 const f=await fixture({policy:{allowUnanswered:true},evaluate:()=>{throw Error('SERVER_SOLUTION_SECRET');}});f.dispatch('start');f.dispatch('submit');await f.engine.whenEvaluationSettled();assert.equal(f.engine.evaluate().status,'failed');assert(!JSON.stringify(f.engine.serialize()).includes('SERVER_SOLUTION_SECRET'));f.engine.dispose();
}
{
 const f=await fixture({policy:{allowUnanswered:true}});let attempts=0;f.engine.subscribe(()=>{attempts++;assert.equal(f.dispatch('submit').code,'action.busy');});f.dispatch('start');assert.equal(attempts,1);f.engine.dispose();
}
{
 const f=await fixture(),registry=createRegistry({validateEngineManifest,validateRendererManifest}),manifest=read('manifests/quiz-practice.v1.json');
 assert(registry.registerEngine(manifest,{createEngine:(activity,context)=>createQuizEngine({...f.options,activity,sessionId:context.sessionId,attemptId:context.attemptId,signal:context.signal},webcrypto),evaluate:engine=>engine.evaluate()}).registered);
 const catalog={catalogVersion:'1.0.0',protocolVersion:'1.0.0',entries:manifest.entries};
 const loaded=await loadActivity(f.activity,{registry,catalog,engineContext:{sessionId:uuid(2),attemptId:uuid(3)},policy:{},availableDrivers:[],generated:false,validateDomainSchema:validateLearnerQuiz,validateDomainSemantics:()=>({valid:true,requirements:{permissions:[],capabilities:['interactive','evaluable']}})});
 assert(loaded.loaded,JSON.stringify(loaded));assert.equal(loaded.engine.dispatch(f.action('start')).status,'accepted');loaded.dispose();registry.dispose();f.engine.dispose();
}
console.log('Quiz engine: attempt actions/limits, navigation, deadlines, feedback/hints, standard events, eight response-kind snapshot round trips, atomic version/digest rejection, duplicate submit, late evaluation, secure projection and actual Core/Registry loading passed.');
