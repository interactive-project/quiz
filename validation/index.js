import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {copyGeneratedJson} from '@interactive-project/protocol/generation/json';
import {validateContent} from '@interactive-project/content-node/validation';
const require=createRequire(import.meta.url),schema=JSON.parse(readFileSync(new URL('../schemas/quiz.v1.schema.json',import.meta.url)));
const ajv=new Ajv2020({strict:true,allErrors:true,ownProperties:true,allowUnionTypes:true});addFormats(ajv);
for(const path of ['@interactive-project/protocol/schemas/shared-content.v1.schema.json','@interactive-project/content-node/schemas/content-node.v1.schema.json'])ajv.addSchema(JSON.parse(readFileSync(require.resolve(path))));
ajv.addSchema(schema);const validators=Object.fromEntries(['author','learner','response'].map(k=>[k,ajv.getSchema(schema.$id+'#/$defs/'+k)]));
const diagnostic=(code,path)=>({code,path,severity:'error',message:'The quiz value violates its declared contract.'});
function prepare(input,kind){const r=copyGeneratedJson(input,{maxBytes:2097152,maxDepth:48,maxCollectionSize:1000,maxStringLength:100000,maxNodes:50000});if(!r.valid)return{valid:false,diagnostics:r.diagnostics};if(!validators[kind](r.value))return{valid:false,diagnostics:[diagnostic('quiz.schema','')]};return{valid:true,value:r.value,diagnostics:[]};}
function validate(input,author){
 const p=prepare(input,author?'author':'learner');if(!p.valid)return p;const quiz=p.value,errors=[],seen=new Set(),fail=(code,path)=>errors.push(diagnostic(code,path));
 const unique=(items,path)=>{const ids=new Set();for(let i=0;i<items.length;i++){if(ids.has(items[i].id))fail('quiz.duplicate',path+'/'+i+'/id');ids.add(items[i].id);}return ids;};
 const content=(value,path)=>{const r=validateContent(value);if(!r.valid)errors.push(...r.diagnostics.map(d=>({...d,path:path+d.path})));};
 for(let i=0;i<quiz.questions.length;i++){
  const q=quiz.questions[i],path='/questions/'+i;if(seen.has(q.id))fail('quiz.duplicate',path+'/id');seen.add(q.id);content(q.prompt,path+'/prompt');
  const choices=q.options??q.items??q.blanks;let choicesIds;
  if(choices){choicesIds=unique(choices,path+(q.options?'/options':q.items?'/items':'/blanks'));choices.forEach((o,j)=>content(o.content??o.prompt,path+(q.options?'/options':q.items?'/items':'/blanks')+'/'+j+(o.content?'/content':'/prompt')));}
  let left,right;if(q.kind==='matching'){left=unique(q.left,path+'/left');right=unique(q.right,path+'/right');if(q.left.length>q.right.length)fail('quiz.cardinality',path+'/right');q.left.forEach((o,j)=>content(o.content,path+'/left/'+j+'/content'));q.right.forEach((o,j)=>content(o.content,path+'/right/'+j+'/content'));for(const id of left)if(right.has(id))fail('quiz.duplicate',path+'/right');}
  if(!author)continue;
  const s=quiz.solutions[q.id],sp='/solutions/'+q.id;if(!s||s.kind!==q.kind){fail('quiz.solution',sp);continue;}
  if(q.kind==='single-choice'&&!choicesIds.has(s.answer))fail('quiz.solution',sp+'/answer');
  if(q.kind==='multiple-choice'&&s.answer.some(id=>!choicesIds.has(id)))fail('quiz.solution',sp+'/answer');
  if(q.kind==='ordering'&&(s.order.length!==choicesIds.size||s.order.some(id=>!choicesIds.has(id))))fail('quiz.solution',sp+'/order');
  if(q.kind==='fill-blank'&&(Object.keys(s.accepted).length!==choicesIds.size||Object.keys(s.accepted).some(id=>!choicesIds.has(id))))fail('quiz.solution',sp+'/accepted');
  if(q.kind==='matching'&&(s.pairs.length!==left.size||new Set(s.pairs.map(p=>p.left)).size!==s.pairs.length||new Set(s.pairs.map(p=>p.right)).size!==s.pairs.length||s.pairs.some(p=>!left.has(p.left)||!right.has(p.right))))fail('quiz.solution',sp+'/pairs');
 }
 if(author&&Object.keys(quiz.solutions).some(id=>!seen.has(id)))fail('quiz.solution','/solutions');
 return errors.length?{valid:false,diagnostics:errors}:{valid:true,diagnostics:[]};
}
export const validateAuthorQuiz=input=>validate(input,true);
export const validateLearnerQuiz=input=>validate(input,false);
export function validateQuizResponse(input,learner){
 const captured=prepare(learner,'learner');if(!captured.valid)return captured;const l=validateLearnerQuiz(captured.value);if(!l.valid)return l;const p=prepare(input,'response');if(!p.valid)return p;const r=p.value,q=captured.value.questions.find(q=>q.id===r.questionId);let valid=!!q&&q.kind===r.kind;
 if(valid){
  const ids=new Set((q.options??q.items??q.blanks??[]).map(o=>o.id));
  if(q.kind==='single-choice')valid=ids.has(r.answer);
  if(q.kind==='multiple-choice')valid=r.answer.every(id=>ids.has(id));
  if(q.kind==='numeric')valid=r.answer.unit===q.unit;
  if(q.kind==='ordering')valid=r.answer.length===ids.size&&r.answer.every(id=>ids.has(id));
  if(q.kind==='fill-blank')valid=Object.keys(r.answer).every(id=>ids.has(id));
  if(q.kind==='matching'){const left=new Set(q.left.map(o=>o.id)),right=new Set(q.right.map(o=>o.id));valid=new Set(r.answer.map(p=>p.left)).size===r.answer.length&&new Set(r.answer.map(p=>p.right)).size===r.answer.length&&r.answer.every(p=>left.has(p.left)&&right.has(p.right));}
 }
 return valid?{valid:true,diagnostics:[]}:{valid:false,diagnostics:[diagnostic('quiz.response','/answer')]};
}
