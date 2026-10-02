import {copyGeneratedJson} from '@interactive-project/protocol/generation/json';
import {canonicalJson} from '@interactive-project/protocol/interoperability';
import {QuizError,toLearnerQuiz,normalizeAnswerText} from '../index.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function copy(input){const r=copyGeneratedJson(input,{maxBytes:2097152,maxDepth:48,maxCollectionSize:1000,maxStringLength:100000,maxNodes:50000});if(!r.valid)throw new QuizError('quiz.evaluationInput');return r.value;}
function checked(fn,...args){try{const r=fn(...args);if(r&&typeof r.then==='function'){Promise.resolve(r).catch(()=>{});return false;}return r?.valid===true;}catch{return false;}}
function frameOf(input){
 const r=copy(input);if(!r||Object.keys(r).some(k=>!['activityId','sessionId','attemptId','generation','revision','responses'].includes(k))||!['activityId','sessionId'].every(k=>typeof r[k]==='string'&&uuid.test(r[k]))||(r.attemptId!==undefined&&!uuid.test(r.attemptId))||(r.generation!==undefined&&!uuid.test(r.generation))||!Number.isSafeInteger(r.revision)||r.revision<0||!Array.isArray(r.responses)||r.responses.length>100)throw new QuizError('quiz.evaluationInput');return r;
}
const base=f=>({protocolVersion:'1.0.0',resultVersion:'1.0.0',activityId:f.activityId,sessionId:f.sessionId,...(f.attemptId!==undefined?{attemptId:f.attemptId}:{}),revision:f.revision,evidence:[]});
const failure=(f,code='evaluation.failure')=>copy({...base(f),status:'failed',failure:{code,message:'The evaluation could not complete.'}});
const pending=f=>copy({...base(f),status:'pending',pendingReason:'evaluation'});
const clamp=x=>Math.max(0,Math.min(1,x));
function responsesOf(frame,learner,validateResponse){
 const seen=new Set();for(const r of frame.responses){if(seen.has(r.questionId)||!checked(validateResponse,r,learner))return null;seen.add(r.questionId);}return new Map(frame.responses.map(r=>[r.questionId,r]));
}
export function createLocalEvaluator({author,scoring={},validateAuthor,validateResponse}){
 if(typeof validateAuthor!=='function'||typeof validateResponse!=='function')throw new QuizError('quiz.evaluator');
 const privateAuthor=copy(author),learner=toLearnerQuiz(privateAuthor,validateAuthor),policy=copy(scoring);
 if(!policy||typeof policy!=='object'||Array.isArray(policy))throw new QuizError('quiz.scoring');
 const partialCredit=policy.partialCredit??true,penalty=policy.penalty??1,weights=policy.weights??{};
 if(Object.keys(policy).some(k=>!['scoringVersion','partialCredit','penalty','weights'].includes(k))||(policy.scoringVersion!==undefined&&policy.scoringVersion!=='1.0.0')||typeof partialCredit!=='boolean'||typeof penalty!=='number'||penalty<0||penalty>1||!weights||typeof weights!=='object'||Array.isArray(weights))throw new QuizError('quiz.scoring');
 const ids=new Set(learner.questions.map(q=>q.id));if(Object.entries(weights).some(([id,w])=>!ids.has(id)||typeof w!=='number'||w<0||w>1000000))throw new QuizError('quiz.scoring');
 const totalWeight=learner.questions.reduce((sum,q)=>sum+(weights[q.id]??1),0);if(totalWeight<=0)throw new QuizError('quiz.scoring');
 function grade(q,s,r){
  if(!r)return 0;const a=r.answer;
  const fraction=(correct,incorrect,total)=>partialCredit?clamp((correct-penalty*incorrect)/total):(correct===total&&incorrect===0?1:0);
  if(q.kind==='single-choice'||q.kind==='true-false')return a===s.answer?1:0;
  if(q.kind==='multiple-choice'){const wanted=new Set(s.answer),correct=a.filter(id=>wanted.has(id)).length;return fraction(correct,a.length-correct,wanted.size);}
  if(q.kind==='numeric')return Math.abs(a.value-s.value)<=Math.max(s.tolerance.absolute,s.tolerance.relative*Math.abs(s.value))?1:0;
  if(q.kind==='short-answer')return s.accepted.some(text=>normalizeAnswerText(text,q.normalization)===normalizeAnswerText(a,q.normalization))?1:0;
  if(q.kind==='fill-blank'){let correct=0,incorrect=0;for(const blank of q.blanks){if(!Object.hasOwn(a,blank.id))continue;if(s.accepted[blank.id].some(text=>normalizeAnswerText(text,blank.normalization)===normalizeAnswerText(a[blank.id],blank.normalization)))correct++;else incorrect++;}return fraction(correct,incorrect,q.blanks.length);}
  if(q.kind==='matching'){const wanted=new Map(s.pairs.map(p=>[p.left,p.right])),correct=a.filter(p=>wanted.get(p.left)===p.right).length;return fraction(correct,a.length-correct,wanted.size);}
  if(q.kind==='ordering'){const correct=a.filter((id,i)=>id===s.order[i]).length;return fraction(correct,a.length-correct,s.order.length);}
  throw new QuizError('quiz.ungradable');
 }
 function evaluate(input){
  const f=frameOf(input),responses=responsesOf(f,learner,validateResponse);if(!responses)return failure(f);
  let weighted=0;for(const q of learner.questions)weighted+=(weights[q.id]??1)*grade(q,privateAuthor.solutions[q.id],responses.get(q.id));
  return copy({...base(f),status:'completed',score:{value:clamp(weighted/totalWeight),scale:'normalized'}});
 }
 return Object.freeze({evaluate});
}
export function createAssessmentEvaluator(options){
 if(!options||!['validateLearner','validateResponse','validateResult','remote','getCurrent'].every(k=>typeof options[k]==='function'))throw new QuizError('quiz.evaluator');
 const learner=copy(options.learner);if(!checked(options.validateLearner,learner))throw new QuizError('quiz.learner');
 const remote=options.remote,validateResponse=options.validateResponse,validateResult=options.validateResult,getCurrent=options.getCurrent,timeoutMs=options.timeoutMs??30000;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new QuizError('quiz.evaluator');
 let status=Object.freeze({phase:'idle'}),current=null,disposed=false;
 function matches(f){try{const c=getCurrent();return c&&['activityId','sessionId','attemptId','generation','revision'].every(k=>c[k]===f[k]);}catch{return false;}}
 function evaluate(input,{signal}={}){
  const f=frameOf(input);if(disposed)return Promise.resolve(failure(f,'evaluation.cancelled'));
  if(!uuid.test(f.generation)||!matches(f))return Promise.resolve(failure(f));if(!responsesOf(f,learner,validateResponse))return Promise.resolve(failure(f));
  const key=canonicalJson(f);if(current?.key===key)return current.promise;
  if(current){current.reason='evaluation.cancelled';current.controller.abort();}
  const controller=new AbortController(),job={key,controller,reason:'evaluation.cancelled',frame:f};current=job;status=Object.freeze({phase:'pending',result:pending(f)});
  let listener,abortListener,timer;
  const interruption=new Promise((_,reject)=>{listener=()=>reject(new QuizError(job.reason));controller.signal.addEventListener('abort',listener,{once:true});});
  const abort=()=>{job.reason='evaluation.cancelled';controller.abort();};abortListener=abort;signal?.addEventListener('abort',abortListener,{once:true});
  timer=setTimeout(()=>{job.reason='evaluation.timeout';controller.abort();},timeoutMs);
  const work=Promise.resolve().then(()=>{if(controller.signal.aborted)throw new QuizError(job.reason);return remote(f,{signal:controller.signal});});
  job.promise=Promise.race([work,interruption]).then(value=>{
   let result;try{result=copy(value);}catch{return failure(f);}
   if(!matches(f)||!checked(validateResult,result,{activityId:f.activityId,sessionId:f.sessionId,attemptId:f.attemptId})||result.revision!==f.revision)return failure(f);return result.status==='failed'?failure(f,result.failure.code):result;
  },()=>failure(f,controller.signal.aborted?job.reason:'evaluation.failure')).then(result=>{
   if(current===job&&!disposed){status=Object.freeze({phase:result.status==='pending'?'pending':result.status==='failed'?'failed':'completed',result});current=null;}
   return result;
  }).finally(()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',listener);signal?.removeEventListener('abort',abortListener);});
  if(signal?.aborted)abort();return job.promise;
 }
 function cancel(){if(current){current.reason='evaluation.cancelled';current.controller.abort();}}
 function dispose(){if(disposed)return;disposed=true;cancel();status=Object.freeze({phase:'disposed'});}
 return Object.freeze({evaluate,cancel,dispose,getStatus:()=>status});
}
