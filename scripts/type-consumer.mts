import {toLearnerQuiz,normalizeAnswerText,type AuthorQuiz,type Response} from '../index.js';
import {validateAuthorQuiz,validateQuizResponse} from '../validation/index.js';
declare const author:AuthorQuiz;
const learner=toLearnerQuiz(author,validateAuthorQuiz);
const response:Response={questionId:'q1',kind:'numeric',answer:{value:2,unit:'m'}};
validateQuizResponse(response,learner);normalizeAnswerText(' A ','nfc-trim-lower');

import {createLocalEvaluator,createAssessmentEvaluator,type EvaluationFrame} from '../evaluation/index.js';
import {validateLearnerQuiz} from '../validation/index.js';
import {validateResult} from '@interactive-project/protocol/validation/interoperability';
declare const frame:EvaluationFrame;
const local=createLocalEvaluator({author,validateAuthor:validateAuthorQuiz,validateResponse:validateQuizResponse});
local.evaluate(frame);
const remote=createAssessmentEvaluator({learner,validateLearner:validateLearnerQuiz,validateResponse:validateQuizResponse,validateResult,getCurrent:()=>frame,remote:f=>local.evaluate(f)});
remote.evaluate(frame);remote.dispose();
