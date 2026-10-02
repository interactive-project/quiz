import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateAuthorQuiz,validateLearnerQuiz,validateQuizResponse} from '../validation/index.js';
import {toLearnerQuiz,normalizeAnswerText} from '../index.js';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url)));
const fixtures=read('fixtures/conformance.json');assert.equal(fixtures.length,24);const kinds=new Set();
for(const f of fixtures){
 const author=read(f.path),r=validateAuthorQuiz(author);assert.equal(r.valid,f.valid,f.path+': '+JSON.stringify(r.diagnostics));kinds.add(f.kind);
 if(f.valid){
  const learner=toLearnerQuiz(author,validateAuthorQuiz);assert(validateLearnerQuiz(learner).valid);assert(!Object.hasOwn(learner,'solutions'));assert(Object.isFrozen(learner.questions));
  const response=read('fixtures/'+f.kind+'.response.json');assert(validateQuizResponse(response,learner).valid,f.kind);
  assert(!validateQuizResponse({...response,questionId:'unknown'},learner).valid);
  assert(!validateLearnerQuiz({...learner,solutions:author.solutions}).valid);
  assert.deepEqual(toLearnerQuiz(author,validateAuthorQuiz),toLearnerQuiz(JSON.parse(JSON.stringify(author)),validateAuthorQuiz));
 }else assert.throws(()=>toLearnerQuiz(author,validateAuthorQuiz),e=>e.code==='quiz.author');
}
assert.equal(kinds.size,8);
const quiz=read('fixtures/single-choice.valid.json'),duplicate=structuredClone(quiz);duplicate.questions.push(duplicate.questions[0]);assert(!validateAuthorQuiz(duplicate).valid);
const empty=structuredClone(quiz);empty.questions[0].options=[];assert(!validateAuthorQuiz(empty).valid);
const extra=structuredClone(quiz);extra.solutions.unknown={kind:'true-false',answer:true};assert(!validateAuthorQuiz(extra).valid);
const textKey=read('fixtures/short-answer.valid.json');textKey.solutions.q5.accepted=['   '];assert(!validateAuthorQuiz(textKey).valid);textKey.solutions.q5.accepted=['Paris',' PARIS '];assert(!validateAuthorQuiz(textKey).valid);
const unsafe=structuredClone(quiz);unsafe.questions[0].prompt.value.translations.en.text=()=>{};assert(!validateAuthorQuiz(unsafe).valid);
for(const [kind,response]of [['multiple-choice',{questionId:'q2',kind:'multiple-choice',answer:['a','a']}],['numeric',{questionId:'q4',kind:'numeric',answer:{value:2,unit:'cm'}}],['fill-blank',{questionId:'q6',kind:'fill-blank',answer:{unknown:'x'}}],['ordering',{questionId:'q8',kind:'ordering',answer:['a']}],['matching',{questionId:'q7',kind:'matching',answer:[{left:'l1',right:'r1'},{left:'l2',right:'r1'}]}]]){
 const author=read('fixtures/'+kind+'.valid.json');assert(!validateQuizResponse(response,toLearnerQuiz(author,validateAuthorQuiz)).valid,kind);
}
assert.equal(normalizeAnswerText(' E\u0301 ','nfc-trim'),'É');assert.equal(normalizeAnswerText(' PARIS ','nfc-trim-lower'),'paris');assert.equal(normalizeAnswerText(' A ','exact'),' A ');
assert.throws(()=>normalizeAnswerText('x','locale-fold'),e=>e.code==='quiz.normalization');
const ts=(await import('typescript')).default,program=ts.createProgram([new URL('./type-consumer.mts',import.meta.url).pathname],{strict:true,noEmit:true,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,lib:['lib.es2022.d.ts']});
const diagnostics=ts.getPreEmitDiagnostics(program);assert.equal(diagnostics.length,0,diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')).join('\n'));
console.log('Quiz contracts: eight valid/invalid/localized families, typed responses, ContentNode, semantic keys and learner solution separation passed.');
