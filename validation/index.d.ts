import type {LearnerQuiz} from '../types/quiz.js';
export interface Diagnostic{code:string;path:string;severity:'error';message:string}
export interface ValidationResult{valid:boolean;diagnostics:Diagnostic[]}
export declare function validateAuthorQuiz(input:unknown):ValidationResult;
export declare function validateLearnerQuiz(input:unknown):ValidationResult;
export declare function validateQuizResponse(input:unknown,learner:unknown):ValidationResult;
