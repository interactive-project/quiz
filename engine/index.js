import {copyGeneratedJson} from '@interactive-project/protocol/generation/json';
import {activityDigest,canonicalJson} from '@interactive-project/protocol/interoperability';
import {createEventBus} from '@interactive-project/events/bus';
import {QuizError} from '../index.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function copy(v){const r=copyGeneratedJson(v,{maxBytes:2097152,maxDepth:48,maxCollectionSize:1000,maxStringLength:100000,maxNodes:50000});if(!r.valid)throw new QuizError('quiz.nonJson');return r.value;}
function check(fn,...args){try{const r=fn(...args);if(r&&typeof r.then==='function'){Promise.resolve(r).catch(()=>{});return false;}return r?.valid===true;}catch{return false;}}
const prefix='interactive-project/quiz.';
export async function createQuizEngine(input,cryptoProvider){
 const options={...input},activity=copy(options.activity),validators={...options.validators};
 if(!['activity','learner','response','action','result','snapshot','event'].every(k=>typeof validators[k]==='function')||!['clock','nextId'].every(k=>typeof options[k]==='function')||typeof options.evaluate!=='function'||!check(validators.activity,activity)||activity.type!=='interactive-project/quiz'||activity.activitySchemaVersion!=='1.0.0'||!check(validators.learner,activity.config)||!uuid.test(options.sessionId)||!uuid.test(options.attemptId)||!uuid.test(options.sourceId))throw new QuizError('quiz.engine');
 const learner=activity.config,policy=copy({maxAttempts:1,navigation:'free',allowUnanswered:false,feedback:'after-submit',hints:'never',timeLimitMs:null,evaluationTimeoutMs:30000,...options.policy});
 if(Object.keys(policy).some(k=>!['maxAttempts','navigation','allowUnanswered','feedback','hints','timeLimitMs','evaluationTimeoutMs'].includes(k))||!Number.isSafeInteger(policy.maxAttempts)||policy.maxAttempts<1||policy.maxAttempts>100||!['free','linear'].includes(policy.navigation)||typeof policy.allowUnanswered!=='boolean'||!['after-submit','after-complete','never'].includes(policy.feedback)||!['during','after-submit','never'].includes(policy.hints)||(policy.timeLimitMs!==null&&(!Number.isSafeInteger(policy.timeLimitMs)||policy.timeLimitMs<1||policy.timeLimitMs>86400000))||!Number.isSafeInteger(policy.evaluationTimeoutMs)||policy.evaluationTimeoutMs<1||policy.evaluationTimeoutMs>60000)throw new QuizError('quiz.policy');
 const digest=await activityDigest(activity,cryptoProvider),policyKey=canonicalJson(policy),clock=options.clock,nextId=options.nextId,service=options.evaluate;
 const id=()=>{let v;try{v=nextId();}catch{throw new QuizError('quiz.id');}if(!uuid.test(v))throw new QuizError('quiz.id');return v;};
 const now=()=>{let v;try{v=clock();}catch{throw new QuizError('quiz.clock');}if(!Number.isSafeInteger(v)||v<0)throw new QuizError('quiz.clock');return v;};
 const initial=(attemptId,attemptNumber=1)=>({stateVersion:'1.0.0',policyKey,lifecycle:'created',phase:'ready',attemptId,attemptNumber,revision:0,actionSequence:0,index:0,responses:{},skipped:[],hintsRequested:[],startedAt:null,feedbackVisible:false});
 let state=copy(initial(options.attemptId)),generation=id(),eventSequence=0,busy=false,disposed=false,job=null,disposeRequested=false;
 const listeners=new Set(),outbox=[],bus=createEventBus({activityId:activity.id,sessionId:options.sessionId,sourceId:options.sourceId,validate:validators.event});
 const identity=()=>({activityId:activity.id,sessionId:options.sessionId,attemptId:state.attemptId});
 const resultBase=(revision=state.revision)=>({protocolVersion:'1.0.0',resultVersion:'1.0.0',...identity(),revision,evidence:[]});
 const failed=(code,revision=state.revision)=>copy({...resultBase(revision),status:'failed',failure:{code,message:'The evaluation could not complete.'}});
 const publicState=()=>{if(state.feedbackVisible||state.result===undefined)return state;const {result,...visible}=state;return copy(visible);};
 function event(type,payload,attemptId=state.attemptId,sequence=eventSequence){const e=copy({protocolVersion:'1.0.0',eventVersion:'1.0.0',id:id(),activityId:activity.id,activityType:activity.type,sessionId:options.sessionId,attemptId,sourceId:options.sourceId,sequence,timestamp:now(),type:'interactive-project/'+type,payload});if(!check(validators.event,e))throw new QuizError('quiz.event');return e;}
 function flushEvents(){if(disposed)return;bus.flush();while(outbox.length){if(!bus.publish(outbox[0]).accepted)break;outbox.shift();}bus.flush();}
 function plan(descriptors,next){flushEvents();if(outbox.length)throw new QuizError('quiz.eventsBlocked');const events=descriptors.map((d,i)=>event(d.type,d.payload,next.attemptId,eventSequence+i)),stats=bus.stats(),bytes=events.reduce((n,e)=>n+new TextEncoder().encode(JSON.stringify(e)).byteLength,0);if(stats.pending+events.length>128||stats.pendingBytes+bytes>4194304)throw new QuizError('quiz.backpressure');return events;}
 function notify(){const value=publicState();for(const listener of [...listeners])try{const r=listener(value);if(r&&typeof r.then==='function')Promise.resolve(r).catch(()=>{});}catch{}}
 function commit(next,events,newGeneration){if(disposed||disposeRequested)throw new QuizError('quiz.disposed');state=copy(next);if(newGeneration)generation=newGeneration;eventSequence+=events.length;outbox.push(...events);notify();flushEvents();}
 function stopJob(){if(job){job.controller.abort();job=null;}}
 function pendingResult(){return copy({...resultBase(),status:'pending',pendingReason:state.phase==='evaluating'?'evaluation':'response'});}
 function evaluate({signal}={}){if(signal?.aborted)throw new QuizError('quiz.cancelled');if(disposed)throw new QuizError('quiz.disposed');return state.result?copy({...state.result,revision:state.revision}):pendingResult();}
 const completeResponse=(q,r)=>!!r&&(q.kind==='fill-blank'?q.blanks.every(b=>Object.hasOwn(r.answer,b.id)&&r.answer[b.id].length>0):q.kind==='matching'?r.answer.length===q.left.length:q.kind==='short-answer'?r.answer.length>0:true);
 function beginEvaluation(){
  const frame=copy({...identity(),generation,revision:state.revision,responses:learner.questions.flatMap(q=>state.responses[q.id]?[state.responses[q.id]]:[])}),controller=new AbortController(),active={controller,frame};job=active;
  let timer,abortListener;
  const interrupted=new Promise((_,reject)=>{abortListener=()=>reject(new QuizError('quiz.cancelled'));controller.signal.addEventListener('abort',abortListener,{once:true});});
  timer=setTimeout(()=>controller.abort(),policy.evaluationTimeoutMs);
  const work=Promise.resolve().then(()=>{if(controller.signal.aborted)throw new QuizError('quiz.cancelled');return service(frame,{signal:controller.signal});});
  active.promise=Promise.race([work,interrupted]).then(value=>{
   let r;try{r=copy(value);}catch{return failed('evaluation.failure',frame.revision);}
   return check(validators.result,r,{activityId:frame.activityId,sessionId:frame.sessionId,attemptId:frame.attemptId})&&r.revision===frame.revision?(r.status==='failed'?failed(r.failure.code,frame.revision):copy({...r,evidence:[]})):failed('evaluation.failure',frame.revision);
  },()=>failed(controller.signal.aborted?'evaluation.timeout':'evaluation.failure',frame.revision)).then(result=>{
   if(disposed||job!==active||generation!==frame.generation||state.attemptId!==frame.attemptId||state.revision!==frame.revision||state.phase!=='evaluating')return;
   job=null;if(result.status==='pending')return;
   const action={protocolVersion:'1.0.0',actionVersion:'1.0.0',...identity(),id:id(),sequence:state.actionSequence,type:prefix+'evaluated',payload:{result}};
   const accepted=dispatch(action,{},true);if(accepted.status!=='accepted')throw new QuizError('quiz.resultBlocked');
  }).catch(()=>{}).finally(()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',abortListener);});
 }
 function dispatch(input,{signal}={},trusted=false){
  let action;try{action=copy(input);}catch{return reject(null,'action.invalid');}
  if(disposed)return reject(action,'action.disposed');if(busy)return reject(action,'action.busy');if(signal?.aborted)return reject(action,'action.invalid');
  busy=true;try{
  if(!check(validators.action,action,identity()))return reject(action,'action.identity');if(action.sequence!==state.actionSequence)return reject(action,'action.stale');
  if(!action.type.startsWith(prefix))return reject(action,'action.unknown');const kind=action.type.slice(prefix.length),p=action.payload;
  const next={...state,responses:{...state.responses},skipped:[...state.skipped],hintsRequested:[...state.hintsRequested],revision:state.revision+1,actionSequence:state.actionSequence+1},descriptors=[];
  const emit=(type,payload)=>descriptors.push({type,payload:{...payload,revision:next.revision}});
  const empty=()=>Object.keys(p).length===0;
  const expired=()=>state.startedAt!==null&&policy.timeLimitMs!==null&&(()=>{const elapsed=now()-state.startedAt;if(elapsed<0)throw new QuizError('quiz.clock');return elapsed>=policy.timeLimitMs;})();
  let changeGeneration=false,submit=false;
  if(kind==='start'&&state.phase==='ready'&&empty()){next.lifecycle='active';next.phase='answering';next.startedAt=now();emit('activity.started',{});emit('attempt.started',{});}
  else if(kind==='answer'&&state.phase==='answering'&&!expired()&&Object.keys(p).join(',')==='response'&&check(validators.response,p.response,learner)&&(policy.navigation==='free'||p.response.questionId===learner.questions[state.index].id)){next.responses[p.response.questionId]=p.response;next.skipped=next.skipped.filter(id=>id!==p.response.questionId);emit('answer.changed',{answerId:p.response.questionId});}
  else if(kind==='clear'&&state.phase==='answering'&&!expired()&&Object.keys(p).join(',')==='questionId'&&learner.questions.some(q=>q.id===p.questionId)&&(policy.navigation==='free'||p.questionId===learner.questions[state.index].id)){delete next.responses[p.questionId];emit('answer.changed',{answerId:p.questionId});}
  else if(kind==='navigate'&&['answering','review'].includes(state.phase)&&Object.keys(p).join(',')==='questionId'){
   const index=learner.questions.findIndex(q=>q.id===p.questionId);if(index<0||(state.phase==='answering'&&(expired()||(policy.navigation==='linear'&&(index!==state.index+1||(!state.responses[learner.questions[state.index].id]&&!state.skipped.includes(learner.questions[state.index].id)))))))return reject(action,'action.invalid');next.index=index;
  }
  else if(kind==='skip'&&state.phase==='answering'&&!expired()&&empty()){const q=learner.questions[state.index];if(!next.skipped.includes(q.id))next.skipped.push(q.id);next.index=Math.min(state.index+1,learner.questions.length-1);}
  else if(kind==='submit'&&state.phase==='answering'&&!expired()&&empty()){
   if(!policy.allowUnanswered&&!learner.questions.every(q=>completeResponse(q,state.responses[q.id])))return reject(action,'action.invalid');
   next.phase='evaluating';emit('attempt.submitted',{});for(const q of learner.questions)if(state.responses[q.id])emit('answer.submitted',{answerId:q.id});submit=true;
  }
  else if(kind==='poll'&&state.phase==='evaluating'&&!job&&empty()){submit=true;}
  else if(kind==='cancel'&&state.phase==='evaluating'&&empty()){next.phase='feedback';next.result=failed('evaluation.cancelled',next.revision);next.feedbackVisible=policy.feedback==='after-submit';changeGeneration=true;}
  else if(kind==='timeout'&&state.phase==='answering'&&expired()&&empty()){next.phase='feedback';next.result=failed('evaluation.timeout',next.revision);next.feedbackVisible=policy.feedback==='after-submit';emit('attempt.submitted',{});descriptors.push({type:'activity.failed',payload:{code:'interactive-project/quiz-timeout',phase:'evaluation',message:'The attempt exceeded its time limit.'}});}
  else if(kind==='evaluated'&&trusted&&state.phase==='evaluating'&&Object.keys(p).join(',')==='result'&&check(validators.result,p.result,identity())&&p.result.revision===state.revision){next.phase='feedback';next.result={...p.result,revision:next.revision};next.feedbackVisible=policy.feedback==='after-submit';}
  else if(kind==='retry'&&['feedback','review'].includes(state.phase)&&empty()&&state.attemptNumber<policy.maxAttempts){const attempt=id();if(attempt===state.attemptId)return reject(action,'action.invalid');Object.assign(next,initial(attempt,state.attemptNumber+1),{lifecycle:'active',phase:'answering',revision:state.revision+1,actionSequence:state.actionSequence+1,startedAt:now()});delete next.result;emit('attempt.started',{});changeGeneration=true;}
  else if(kind==='review'&&state.phase==='feedback'&&empty()){next.phase='review';}
  else if(kind==='hint'&&Object.keys(p).join(',')==='questionId'&&learner.questions.some(q=>q.id===p.questionId)&&((state.phase==='answering'&&policy.hints==='during')||(['feedback','review'].includes(state.phase)&&policy.hints!=='never'))&&!state.hintsRequested.includes(p.questionId)){next.hintsRequested.push(p.questionId);emit('hint.requested',{hintId:p.questionId});}
  else if(kind==='complete'&&['feedback','review'].includes(state.phase)&&empty()&&state.result&&state.result.status!=='pending'){
   next.lifecycle='completed';next.phase='completed';next.feedbackVisible=policy.feedback!=='never';next.result={...state.result,revision:next.revision};
   if(next.result.status==='failed')descriptors.push({type:'activity.failed',payload:{code:'interactive-project/quiz-evaluation',phase:'evaluation',message:'The evaluation could not complete.'}});
   else descriptors.push({type:'activity.completed',payload:{result:next.result}});
  }
  else return reject(action,'action.invalid');
  descriptors.unshift({type:'activity.interacted',payload:{actionId:action.id,actionType:action.type,revision:next.revision}});
  const events=plan(descriptors,next),newGeneration=changeGeneration?id():null;if(signal?.aborted)return reject(action,'action.invalid');commit(next,events,newGeneration);if(changeGeneration)stopJob();if(submit)beginEvaluation();return{status:'accepted',actionId:action.id,revision:next.revision};}finally{busy=false;if(disposeRequested)dispose();}
 }
 function reject(action,code){return{status:'rejected',actionId:uuid.test(action?.id)?action.id:'00000000-0000-4000-8000-000000000000',code,path:'',message:'The action cannot be applied.'};}
 function serialize(){
  if(disposed)throw new QuizError('quiz.disposed');if(busy)throw new QuizError('quiz.busy');
  return copy({protocolVersion:'1.0.0',snapshotVersion:'1.0.0',activity:{id:activity.id,type:activity.type,activitySchemaVersion:activity.activitySchemaVersion,contentDigest:digest},engine:{id:'interactive-project/quiz',stateVersion:'1.0.0'},session:{id:options.sessionId,attemptId:state.attemptId,revision:state.revision},state,drivers:{}});
 }
 function validState(s,snapshot){
  if(!s||Object.keys(s).some(k=>!['stateVersion','policyKey','lifecycle','phase','attemptId','attemptNumber','revision','actionSequence','index','responses','skipped','hintsRequested','startedAt','feedbackVisible','result'].includes(k))||s.stateVersion!=='1.0.0'||s.policyKey!==policyKey||s.attemptId!==snapshot.session.attemptId||s.revision!==snapshot.session.revision||s.actionSequence!==s.revision||!Number.isSafeInteger(s.attemptNumber)||s.attemptNumber<1||s.attemptNumber>policy.maxAttempts||!Number.isSafeInteger(s.index)||s.index<0||s.index>=learner.questions.length||!['ready','answering','evaluating','feedback','review','completed'].includes(s.phase)||!['created','active','completed'].includes(s.lifecycle)||typeof s.feedbackVisible!=='boolean'||!(s.startedAt===null||Number.isSafeInteger(s.startedAt)&&s.startedAt>=0)||!s.responses||Array.isArray(s.responses)||!Array.isArray(s.skipped)||!Array.isArray(s.hintsRequested))return false;
  if(s.phase==='ready'?(s.lifecycle!=='created'||s.startedAt!==null):(s.startedAt===null||s.lifecycle!==(s.phase==='completed'?'completed':'active')))return false;
  for(const list of [s.skipped,s.hintsRequested])if(new Set(list).size!==list.length||list.some(id=>!learner.questions.some(q=>q.id===id)))return false;
  if(Object.entries(s.responses).some(([id,r])=>!r||typeof r!=='object'||Array.isArray(r)||r.questionId!==id||!check(validators.response,r,learner)))return false;
  if(s.result!==undefined&&(!check(validators.result,s.result,{activityId:activity.id,sessionId:options.sessionId,attemptId:s.attemptId})||s.result.revision>s.revision||!['feedback','review','completed'].includes(s.phase)))return false;
  if(['feedback','review','completed'].includes(s.phase)&&(!s.result||s.result.status==='pending'))return false;
  const permitted=policy.feedback==='after-submit'?['feedback','review','completed'].includes(s.phase):policy.feedback==='after-complete'?s.phase==='completed':false;return s.feedbackVisible===permitted;
 }
 function restore(input,{signal}={}){
  if(disposed||busy)throw new QuizError(disposed?'quiz.disposed':'quiz.busy');if(signal?.aborted)throw new QuizError('quiz.cancelled');busy=true;try{const snapshot=copy(input);
  if(!check(validators.snapshot,snapshot,{activityId:activity.id,activityType:activity.type,activitySchemaVersion:activity.activitySchemaVersion,contentDigest:digest,engineId:'interactive-project/quiz',engineStateVersion:'1.0.0',sessionId:options.sessionId,attemptId:state.attemptId})||Object.keys(snapshot.drivers??{}).length||!validState(snapshot.state,snapshot))throw new QuizError('quiz.snapshot');
  const next={...snapshot.state};if(next.phase==='evaluating'){next.phase='feedback';next.result=failed('evaluation.cancelled',next.revision);next.feedbackVisible=policy.feedback==='after-submit';}
  const newGeneration=id();if(newGeneration===generation)throw new QuizError('quiz.generation');
  const events=plan([{type:'activity.resumed',payload:{revision:next.revision,snapshotVersion:'1.0.0'}}],next);if(signal?.aborted)throw new QuizError('quiz.cancelled');commit(next,events,newGeneration);stopJob();}finally{busy=false;if(disposeRequested)dispose();}
 }
 function dispose(){if(disposed)return;if(busy){disposeRequested=true;return;}disposed=true;stopJob();state=copy({...state,lifecycle:'disposed'});bus.dispose();outbox.length=0;notify();listeners.clear();}
 const created=event('activity.created',{engineId:'interactive-project/quiz',engineStateVersion:'1.0.0'});outbox.push(created);eventSequence++;flushEvents();
 if(options.signal?.aborted){dispose();throw new QuizError('quiz.cancelled');}
 return Object.freeze({dispatch:(a,o)=>dispatch(a,o),evaluate,serialize,restore,dispose,getState:publicState,getContext:()=>Object.freeze({...identity(),generation,revision:state.revision}),getFeedback:()=>state.feedbackVisible&&state.result?evaluate():null,subscribe(listener){if(disposed||typeof listener!=='function'||listeners.size>=128)throw new QuizError('quiz.subscription');listeners.add(listener);return()=>listeners.delete(listener);},subscribeEvents:bus.subscribe,flushEvents,whenEvaluationSettled:()=>job?.promise??Promise.resolve()});
}
