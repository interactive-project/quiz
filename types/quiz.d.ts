import type {ContentNode,DeepReadonly} from '@interactive-project/content-node';
export type TextNormalization='exact'|'nfc-trim'|'nfc-trim-lower';
export interface Option{id:string;content:ContentNode}
export interface QuestionBase{id:string;prompt:ContentNode}
export type Question=
 |QuestionBase&{kind:'single-choice'|'multiple-choice';options:Option[]}
 |QuestionBase&{kind:'true-false'}
 |QuestionBase&{kind:'numeric';unit:string}
 |QuestionBase&{kind:'short-answer';normalization:TextNormalization}
 |QuestionBase&{kind:'fill-blank';blanks:{id:string;prompt:ContentNode;normalization:TextNormalization}[]}
 |QuestionBase&{kind:'matching';left:Option[];right:Option[];cardinality:'one-to-one'}
 |QuestionBase&{kind:'ordering';items:Option[]};
export interface Pair{left:string;right:string}
export type Solution=
 |{kind:'single-choice';answer:string}|{kind:'multiple-choice';answer:string[]}|{kind:'true-false';answer:boolean}
 |{kind:'numeric';value:number;tolerance:{absolute:number;relative:number}}
 |{kind:'short-answer';accepted:string[]}|{kind:'fill-blank';accepted:Record<string,string[]>}
 |{kind:'matching';pairs:Pair[]}|{kind:'ordering';order:string[]};
export interface LearnerQuiz{schemaVersion:'1.0.0';questions:Question[]}
export interface AuthorQuiz extends LearnerQuiz{solutions:Record<string,Solution>}
export type Response=
 |{questionId:string;kind:'single-choice';answer:string}|{questionId:string;kind:'multiple-choice';answer:string[]}
 |{questionId:string;kind:'true-false';answer:boolean}|{questionId:string;kind:'numeric';answer:{value:number;unit:string}}
 |{questionId:string;kind:'short-answer';answer:string}|{questionId:string;kind:'fill-blank';answer:Record<string,string>}
 |{questionId:string;kind:'matching';answer:Pair[]}|{questionId:string;kind:'ordering';answer:string[]};
export declare class QuizError extends Error{readonly code:string}
export declare function toLearnerQuiz(input:AuthorQuiz,validateAuthor:(input:unknown)=>{valid:boolean}):DeepReadonly<LearnerQuiz>;
export declare function normalizeAnswerText(value:string,mode:TextNormalization):string;
