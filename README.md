# Interactive Project Quiz

Portable question contracts for single-choice, multiple-choice, true-false, numeric, short-answer, fill-blank, matching and ordering.

The pure root exports types, toLearnerQuiz and deterministic text normalization. The optional Node/Ajv ./validation entry validates author documents, learner documents and question-bound responses using offline Protocol/ContentNode schemas. See [quiz-v1](docs/quiz-v1.md) for semantics and fixtures. The ./engine and ./evaluation entries implement the v1 attempt and evaluation contracts. Run npm ci --ignore-scripts and npm test.

- [Interop, generated-activity gates and host acceptance plan](docs/interop-v1.md)

The current conformance suite round-trips all eight response kinds and exercises generated Quiz validation through Protocol, Registry and Core. The shared host trace runs headlessly; DOM/React/Vue/Svelte renderer parity remains gated on their separate adapters. This repository state is not an npm publication claim.
