import {toLearnerQuiz,normalizeAnswerText,type AuthorQuiz,type Response} from '../index.js';
import {validateAuthorQuiz,validateQuizResponse} from '../validation/index.js';
declare const author:AuthorQuiz;
const learner=toLearnerQuiz(author,validateAuthorQuiz);
const response:Response={questionId:'q1',kind:'numeric',answer:{value:2,unit:'m'}};
validateQuizResponse(response,learner);normalizeAnswerText(' A ','nfc-trim-lower');
