import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLocalEvaluator,createAssessmentEvaluator} from '../evaluation/index.js';
import {validateAuthorQuiz,validateLearnerQuiz,validateQuizResponse} from '../validation/index.js';
import {toLearnerQuiz} from '../index.js';
import {validateResult} from '@interactive-project/protocol/validation/interoperability';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const read=path=>JSON.parse(readFileSync(new URL('../fixtures/'+path+'.json',import.meta.url))),clone=v=>JSON.parse(JSON.stringify(v));
const kinds=['single-choice','multiple-choice','true-false','numeric','short-answer','fill-blank','matching','ordering'];
const authors=kinds.map(k=>read(k+'.valid')),responses=kinds.map(k=>read(k+'.response'));
const author={schemaVersion:'1.0.0',questions:authors.flatMap(a=>a.questions),solutions:Object.assign({},...authors.map(a=>a.solutions))};
const frame={activityId:uuid(1),sessionId:uuid(2),attemptId:uuid(3),generation:uuid(4),revision:2,responses};
const localOptions={author,validateAuthor:validateAuthorQuiz,validateResponse:validateQuizResponse};
const evaluator=createLocalEvaluator(localOptions);
const correct=evaluator.evaluate(frame);assert(validateResult(correct).valid);assert.equal(correct.score.value,1);assert.deepEqual(evaluator.evaluate(frame),correct);assert(Object.isFrozen(correct.score));assert.equal(evaluator.evaluate({...frame,responses:[]}).score.value,0);
const wrong=['b',['c'],false,{value:9,unit:'m'},'Tokyo',{b1:'Tokyo'},[{left:'l1',right:'r2'},{left:'l2',right:'r1'}],['b','a']];
for(let i=0;i<kinds.length;i++){
 const one=createLocalEvaluator({...localOptions,author:authors[i]});
 assert.equal(one.evaluate({...frame,responses:[responses[i]]}).score.value,1,kinds[i]);
 assert.equal(one.evaluate({...frame,responses:[{...responses[i],answer:wrong[i]}]}).score.value,0,kinds[i]);
 assert.equal(one.evaluate({...frame,responses:[]}).score.value,0,kinds[i]);
}
{
 const opts={...localOptions,author:authors[1]},r={...responses[1],answer:['a','c']};
 assert.equal(createLocalEvaluator({...opts,scoring:{penalty:0.5}}).evaluate({...frame,responses:[r]}).score.value,0.25);
 assert.equal(createLocalEvaluator({...opts,scoring:{penalty:0}}).evaluate({...frame,responses:[r]}).score.value,0.5);
 assert.equal(createLocalEvaluator({...opts,scoring:{partialCredit:false}}).evaluate({...frame,responses:[{...r,answer:['a']}]}).score.value,0);
 const weights=Object.fromEntries(author.questions.map(q=>[q.id,0]));weights.q1=3;weights.q3=1;
 const weighted=createLocalEvaluator({...localOptions,scoring:{weights}});assert.equal(weighted.evaluate({...frame,responses:[responses[0]]}).score.value,0.75);
 assert.throws(()=>createLocalEvaluator({...localOptions,scoring:{weights:Object.fromEntries(author.questions.map(q=>[q.id,0]))}}),e=>e.code==='quiz.scoring');
 assert.throws(()=>createLocalEvaluator({...localOptions,scoring:{penalty:1.01}}),e=>e.code==='quiz.scoring');
}
{
 const opts={...localOptions,author:authors[3]},r={...responses[3],answer:{value:2.01,unit:'m'}};assert.equal(createLocalEvaluator(opts).evaluate({...frame,responses:[r]}).score.value,1);
 assert.equal(createLocalEvaluator(opts).evaluate({...frame,responses:[{...r,answer:{value:2.010000001,unit:'m'}}]}).score.value,0);
 const zero=clone(authors[3]);zero.solutions.q4.value=0;zero.solutions.q4.tolerance={absolute:0,relative:1};const e=createLocalEvaluator({...opts,author:zero});assert.equal(e.evaluate({...frame,responses:[{...r,answer:{value:0,unit:'m'}}]}).score.value,1);assert.equal(e.evaluate({...frame,responses:[{...r,answer:{value:0.0001,unit:'m'}}]}).score.value,0);
 const invalid=e.evaluate({...frame,responses:[{...r,answer:{value:0,unit:'cm'}}]});assert.equal(invalid.status,'failed');assert(!Object.hasOwn(invalid,'score'));
}
assert.equal(evaluator.evaluate({...frame,responses:[responses[0],responses[0]]}).status,'failed');
const hidden=clone(author);hidden.solutions.q5.accepted=['SERVER_ONLY_KEY'];const learner=toLearnerQuiz(hidden,validateAuthorQuiz);
const remoteOptions={learner,validateLearner:validateLearnerQuiz,validateResponse:validateQuizResponse,validateResult,getCurrent:()=>frame,remote:async request=>{assert(!JSON.stringify(request).includes('SERVER_ONLY_KEY'));assert(!Object.hasOwn(request,'solutions'));assert(!Object.hasOwn(request,'questions'));return evaluator.evaluate(request)}};
{
 const remote=createAssessmentEvaluator(remoteOptions),p=remote.evaluate(frame);assert.equal(remote.getStatus().phase,'pending');assert.equal(remote.getStatus().result.status,'pending');assert.equal(remote.evaluate(frame),p);const r=await p;assert.deepEqual(r,correct);assert.equal(remote.getStatus().phase,'completed');assert(!JSON.stringify(remote.getStatus()).includes('SERVER_ONLY_KEY'));remote.dispose();
}
{
 const remote=createAssessmentEvaluator({...remoteOptions,remote:()=>{throw Error('SERVER_ONLY_KEY')}});const r=await remote.evaluate(frame);assert.equal(r.status,'failed');assert(!JSON.stringify(r).includes('SERVER_ONLY_KEY'));remote.dispose();
 const foreign=createAssessmentEvaluator({...remoteOptions,remote:()=>({...correct,sessionId:uuid(9)})});assert.equal((await foreign.evaluate(frame)).status,'failed');foreign.dispose();
 const malformed=createAssessmentEvaluator({...remoteOptions,remote:()=>({...correct,score:{value:1.1,scale:'normalized'}})});assert.equal((await malformed.evaluate(frame)).status,'failed');malformed.dispose();
}
{
 const timeout=createAssessmentEvaluator({...remoteOptions,timeoutMs:10,remote:()=>new Promise(()=>{})});const r=await timeout.evaluate(frame);assert.equal(r.failure.code,'evaluation.timeout');assert(!Object.hasOwn(r,'score'));timeout.dispose();
 const cancel=createAssessmentEvaluator({...remoteOptions,remote:()=>new Promise(()=>{})}),signal=new AbortController();const p=cancel.evaluate(frame,{signal:signal.signal});signal.abort();assert.equal((await p).failure.code,'evaluation.cancelled');cancel.dispose();
}
{
 let resolve;const current={...frame},remote=createAssessmentEvaluator({...remoteOptions,getCurrent:()=>current,remote:()=>new Promise(r=>resolve=r)});
 const p=remote.evaluate(frame);await new Promise(r=>setImmediate(r));current.generation=uuid(99);resolve(correct);assert.equal((await p).status,'failed');remote.dispose();
 const pending=createAssessmentEvaluator({...remoteOptions,remote:()=>({protocolVersion:'1.0.0',resultVersion:'1.0.0',activityId:frame.activityId,sessionId:frame.sessionId,attemptId:frame.attemptId,revision:frame.revision,evidence:[],status:'pending',pendingReason:'evaluation'})});assert.equal((await pending.evaluate(frame)).status,'pending');assert.equal(pending.getStatus().phase,'pending');pending.dispose();
}
console.log('Quiz evaluation: eight-kind grading, normalized bounded weighting/penalty/partial credit, tolerance, unanswered, idempotency and trusted remote result/cancel/timeout correlation passed.');
