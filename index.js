import {copyGeneratedJson} from '@interactive-project/protocol/generation/json';
export class QuizError extends Error{constructor(code){super('Quiz operation rejected.');this.name='QuizError';this.code=code;}}
export function toLearnerQuiz(input,validateAuthor){
 const r=copyGeneratedJson(input,{maxBytes:2097152,maxDepth:48,maxCollectionSize:1000,maxStringLength:100000,maxNodes:50000});if(!r.valid||typeof validateAuthor!=='function')throw new QuizError('quiz.author');
 let checked;try{checked=validateAuthor(r.value);}catch{throw new QuizError('quiz.author');}
 if(checked&&typeof checked.then==='function'){Promise.resolve(checked).catch(()=>{});throw new QuizError('quiz.author');}
 if(checked?.valid!==true)throw new QuizError('quiz.author');
 return copyGeneratedJson({schemaVersion:r.value.schemaVersion,questions:r.value.questions}).value;
}
export function normalizeAnswerText(value,mode){
 if(typeof value!=='string'||!['exact','nfc-trim','nfc-trim-lower'].includes(mode))throw new QuizError('quiz.normalization');
 if(mode==='exact')return value;const text=value.normalize('NFC').trim();return mode==='nfc-trim-lower'?text.toLowerCase():text;
}
