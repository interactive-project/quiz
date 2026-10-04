import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateAuthorQuiz,validateLearnerQuiz,validateQuizResponse} from '../validation/index.js';
import {toLearnerQuiz} from '../index.js';

const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const plan=read('fixtures/renderer-contract.v1.json');
const trace=read('fixtures/host-conformance.v1.json');
const packageJson=read('package.json');
const hosts=['headless','dom','react','vue','svelte'];
assert.deepEqual(plan.hostTargets,hosts);
assert.deepEqual(trace.hostAdapters.map(host=>host.id),hosts);
assert.equal(trace.hostAdapters[0].status,'implemented');
assert(trace.hostAdapters.slice(1).every(host=>host.status==='planned-separate-package'));
assert.deepEqual(plan.deferredQuestionExtensions,['formula','essay','oral','hotspot']);
assert(plan.requiredAccessibility.length>=5);
assert(!Object.keys(packageJson.devDependencies).some(name=>/^(react|vue|svelte|xstate|jsdom|happy-dom)$/.test(name)));

const author=read(plan.accessibilityFixture);
assert(validateAuthorQuiz(author).valid);
const learner=toLearnerQuiz(author,validateAuthorQuiz);
assert(validateLearnerQuiz(learner).valid);
assert(!Object.hasOwn(learner,'solutions'));
const question=learner.questions[0],promptAccessibility=question.prompt.accessibility;
assert.equal(promptAccessibility.kind,'accessibility');
assert(promptAccessibility.label&&promptAccessibility.instructions&&promptAccessibility.equivalentExperience);
assert(validateQuizResponse(read('fixtures/single-choice.response.json'),toLearnerQuiz(read('fixtures/single-choice.valid.json'),validateAuthorQuiz)).valid);

const requiredLocales=['en','es','ar'];
const localizedContent=value=>{
 if(!value||typeof value!=='object')return[];
 if(value.kind==='localized-text')return[value];
 return Object.values(value).flatMap(localizedContent);
};
for(const path of plan.localizedQuestionFixtures){
 const fixture=read(path);
 assert(validateAuthorQuiz(fixture).valid,path);
 const localized=localizedContent(fixture.questions[0].prompt);
 assert(localized.length>0,path+' prompt localization');
 for(const text of localized)for(const locale of requiredLocales)assert(text.translations[locale],`${path} missing ${locale}`);
}
for(const choice of question.options){
 const label=choice.content.accessibility?.label;
 assert(label,`${choice.id} must have an accessible answer label`);
 for(const locale of requiredLocales)assert(label.translations[locale],`${choice.id} label missing ${locale}`);
 assert.equal(label.translations.ar.direction,'rtl');
}
assert(promptAccessibility.equivalentExperience.translations.en.text.length>0);
assert.equal(promptAccessibility.equivalentExperience.translations.ar.direction,'rtl');

console.log('Quiz renderer contract: the shared headless/DOM/React/Vue/Svelte trace, eight localized question fixtures, accessible prompt/choice labels, keyboard equivalent and RTL Arabic fixture passed; visual host claims remain gated on separate adapters.');
