import type {ActivitySpec} from '@interactive-project/protocol/types';
import type {EngineSession,Action,DispatchResult,Result,Snapshot,CancellationSignal,MaybePromise} from '@interactive-project/protocol/interoperability';
import type {ActivityEvent} from '@interactive-project/events';
import type {Response} from '../types/quiz.js';
import type {EvaluationFrame} from '../evaluation/index.js';
export interface AttemptPolicy{maxAttempts?:number;navigation?:'free'|'linear';allowUnanswered?:boolean;feedback?:'after-submit'|'after-complete'|'never';hints?:'during'|'after-submit'|'never';timeLimitMs?:number|null;evaluationTimeoutMs?:number}
export interface QuizState{stateVersion:'1.0.0';policyKey:string;lifecycle:'created'|'active'|'completed'|'disposed';phase:'ready'|'answering'|'evaluating'|'feedback'|'review'|'completed';attemptId:string;attemptNumber:number;revision:number;actionSequence:number;index:number;responses:Record<string,Response>;skipped:string[];hintsRequested:string[];startedAt:number|null;feedbackVisible:boolean;result?:Result}
export interface QuizEngine extends EngineSession{
 dispatch(action:Action,options?:{signal?:CancellationSignal}):DispatchResult;
 evaluate(options?:{signal?:CancellationSignal}):Result;serialize():Snapshot;restore(snapshot:Snapshot,options?:{signal?:CancellationSignal}):void;dispose():void;
 getState():Readonly<QuizState>;getContext():Readonly<{activityId:string;sessionId:string;attemptId:string;generation:string;revision:number}>;
 getFeedback():Result|null;subscribe(listener:(state:Readonly<QuizState>)=>unknown):()=>void;
 subscribeEvents(listener:(event:ActivityEvent)=>unknown,options?:{replay?:boolean}):()=>void;flushEvents():void;whenEvaluationSettled():Promise<unknown>;
}
export interface QuizEngineOptions{
 activity:ActivitySpec;sessionId:string;attemptId:string;sourceId:string;signal?:CancellationSignal;policy?:AttemptPolicy;
 clock():number;nextId():string;evaluate(frame:EvaluationFrame,options:{signal:CancellationSignal}):MaybePromise<Result>;
 validators:{activity(input:unknown):{valid:boolean};learner(input:unknown):{valid:boolean};response(input:unknown,learner:unknown):{valid:boolean};action(input:unknown,expected?:{activityId:string;sessionId:string;attemptId?:string}):{valid:boolean};result(input:unknown,expected?:{activityId:string;sessionId:string;attemptId?:string}):{valid:boolean};snapshot(input:unknown,expected?:Record<string,string|undefined>):{valid:boolean};event(input:unknown):{valid:boolean}};
}
export declare function createQuizEngine(options:QuizEngineOptions,cryptoProvider?:{subtle:{digest(algorithm:string,data:Uint8Array):Promise<ArrayBuffer>}}):Promise<QuizEngine>;
