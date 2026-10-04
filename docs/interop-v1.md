# Quiz interoperability and generated-activity acceptance v1

## Version and evaluator declaration

The engine manifest is the compatibility authority for registration: Protocol `1.0.0`, Quiz `activitySchemaVersion` `1.0.0`, schema ID `...quiz.v1.schema.json#/$defs/learner`, engine ID `interactive-project/quiz`, engine state version `1.0.0`, and plugin version `0.1.0`. The manifest requires `interactive` and `evaluable`; `evaluable` is true only when the host injects the trusted evaluator port. The published practice manifest describes an offline local evaluator, so `offline` is true and no permission is required. A host substituting remote assessment must publish/register a matching host-specific manifest/catalog with `offline:false`, `network` permission, and enforce that permission in its service boundary. Capability metadata never installs or authorizes a service.

The public package boundary is:

| Entry point | Role | Environment |
| --- | --- | --- |
| `.` | Types, learner projection and deterministic text normalization | Headless ES module; Node 22 is the verified CI runtime |
| `./validation` | Author/learner/response schema and semantic validators | Optional Node/Ajv adapter |
| `./evaluation` | Local and host-injected assessment evaluators | Node 22 verified |
| `./engine` | Protocol EngineSession implementation | Headless ES module; host supplies validators, clock, IDs and evaluator |
| `./schemas/quiz.v1.schema.json` | Quiz JSON Schema | Static data |
| `./manifests/quiz-practice.v1.json` | Exact generation/engine capability manifest | Static data |

Protocol, Content Node and Events are `0.1.0` peers; Ajv and ajv-formats are optional peers used by Node validation/evaluation. Registry and Core are test-only development dependencies. CI locks them to exact reviewed Git SHAs. This is source-repository compatibility evidence only, not an npm publication or public-scope guarantee. Browser/framework support is supplied and tested by separate host packages, not implied by these exports.

## Snapshot and migration acceptance

The headless engine must round-trip a valid answered snapshot for every v1 response kind: single-choice, multiple-choice, true-false, numeric, short-answer, fill-blank, matching and ordering. Restore tests use each authored/response fixture pair, compare the complete portable state and verify the `activity.resumed` event. Mutated Protocol, snapshot, activity-schema and engine-state versions, content digest, identity, malformed response and driver payloads must reject atomically without changing the current engine state. Quiz v1 has no implicit cross-version migration: until a separately reviewed migration is registered, unsupported versions are rejected.

## Shared host trace

[`fixtures/host-conformance.v1.json`](../fixtures/host-conformance.v1.json) is the golden host trace: create, start, answer, submit, await evaluation, complete, compare aggregate result and ordered Events, then compare a portable snapshot/restore. It is run now against the headless engine and is the required input for later DOM, React, Vue and Svelte adapters. Adapter comparisons retain result status/score, event type/payload/revision order and portable state/version fields; host/session/source IDs, event UUIDs and timestamps are normalized out. No React, Vue, Svelte, browser or XState dependency is installed by this package.

At this issue's implementation, only the headless engine is executable. The `dom`, `react`, `vue` and `svelte` rows are conformance targets, not claims that their separate renderer repositories already exist. A host integration must run the identical trace without changing domain results or event semantics before it can claim compatibility.

## Renderer accessibility and localization contract

[`fixtures/renderer-accessibility.valid.json`](../fixtures/renderer-accessibility.valid.json) exercises ContentNode localized visible text, explicit accessible question/choice labels, instructions, an equivalent keyboard/assistive-technology experience, and English, Spanish and Arabic text with RTL direction. A renderer must:

- expose each question prompt as the accessible name/instructions for its response group and every option as the accessible name for the corresponding control;
- preserve author-provided ContentNode accessibility labels, instructions, descriptions and equivalent experiences instead of replacing them with unlabeled icons or vendor metadata;
- provide keyboard-operable, non-drag response alternatives for ordering and matching, and announce validation, progress, submission and aggregate feedback without relying on color alone;
- render a deterministic locale fallback and preserve language/direction metadata, including RTL, on both visible and accessible text;
- keep answer keys, hidden evaluator material and raw answer data out of accessible labels and activity events.

The Quiz contract stores content and accessibility metadata; it does not certify an actual UI or WCAG conformance. Every host package must perform its own accessibility tests with the shared fixtures and document host limitations. Formula, essay, oral and hotspot questions are deferred to explicitly versioned extensions; v1 does not infer them from arbitrary content or UI capabilities.

## Generated activity gates

Generated text or JSON follows Protocol's order: bounded structural/envelope and exact catalog schema checks; Quiz learner schema validation; trusted Quiz semantic callback; host permission checks; required capability/driver resolution; only then Core may call the registered engine factory. Tests cover malformed/invalid Quiz config, an intentionally failing trusted semantic callback, denied execution permission and a catalog with `aiGeneratable` disabled. Each rejection is checked through both `validateGeneratedActivity` and Core `loadActivity`, and must occur before the engine factory or `start` action. Valid generated learner JSON must not contain the author solution map. The evaluator and domain callbacks are host-trusted code; generated content never supplies code, permissions, module URLs or validators.

## Verification and compatibility

CI pins Protocol, Content Node, Events, Registry and Core to exact reviewed Git commits and runs the full suite on Node.js 22. These source pins are not an npm release claim. Protocol/Events wire schemas remain unchanged. A contract-version change requires explicit review and fixtures; a same-contract dependency SHA update must pass the complete host/generation/snapshot suite. No v1 activity or snapshot migration is introduced by this plan.
