# Interactive Project Quiz

Portable question contracts for single-choice, multiple-choice, true-false, numeric, short-answer, fill-blank, matching and ordering.

The pure root exports types, toLearnerQuiz and deterministic text normalization. The optional Node/Ajv ./validation entry validates author documents, learner documents and question-bound responses using offline Protocol/ContentNode schemas. See [quiz-v1](docs/quiz-v1.md) for semantics and fixtures. Run npm ci --ignore-scripts and npm test. Domain state and evaluation are introduced in quiz#2 and quiz#3.
