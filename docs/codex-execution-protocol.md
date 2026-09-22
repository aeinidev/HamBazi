# HamBazi Codex Execution Protocol

## Purpose

This file defines the persistent execution protocol Codex must follow while implementing the HamBazi project.

It is an operational workflow document. It does **not** replace or override the project architecture or repository implementation guidance.

## Authority and Precedence

Before making implementation changes, read these files in full:

1. `HamBazi_Software_Architecture_v1.1_Reviewed.md`
2. `AGENTS.md`
3. `docs/implementation-plan.md`
4. This file: `docs/codex-execution-protocol.md`

Treat:

- `HamBazi_Software_Architecture_v1.1_Reviewed.md` as the authoritative source for architecture, product scope, technical decisions, constraints, and quality requirements.
- `AGENTS.md` as the repository's operational implementation guide.
- `docs/implementation-plan.md` as the current execution roadmap and phase-status record.
- This file as the persistent Codex working protocol.

If this file conflicts with the architecture document or `AGENTS.md`, do not silently resolve the conflict. Report the conflict and stop before making the affected change.

## Repository State Is the Source of Truth

Do not rely on chat history as the primary record of project state.

At the beginning of every new Codex conversation or newly authorized phase:

- Inspect the current repository state.
- Inspect Git status and preserve all existing user changes.
- Read the architecture, `AGENTS.md`, implementation plan, and relevant existing code.
- Verify the status of prerequisites relevant to the authorized phase.
- Use the repository and tracked documentation as the source of truth for what has actually been implemented.
- Never redo a completed phase merely because the current conversation is new.
- If a previously completed prerequisite is genuinely missing, incorrect, or blocking the authorized phase, report the evidence and stop rather than silently reimplementing unrelated prior work.

Do not delete, overwrite, revert, or replace existing user work without understanding it first and obtaining approval when the action is destructive or difficult to reverse.

## Phase-Based Working Model

Implementation must proceed in small, independent, testable, and reviewable phases or subphases.

`docs/implementation-plan.md` must remain the live record of:

- Objective
- Scope
- Expected deliverables
- Dependencies
- Acceptance criteria
- Required tests and validations
- Status: `Pending`, `In Progress`, `Completed`, or `Blocked`

If a phase is too large to complete safely as one reviewable unit, divide it into explicit subphases such as `10A`, `10B`, and `10C`.

### Authorization Boundary

The user's phase starter message defines the currently authorized phase or subphase.

Do **not** begin a later phase merely because the current one is finished.

Do **not** broaden the current phase beyond its documented scope unless the user explicitly approves the change.

If work from another phase is required only as a true prerequisite and is not already present, stop and report the dependency instead of silently expanding scope.

## Mandatory Phase Gate

Complete only the currently authorized phase or subphase.

After completing it:

1. Run all relevant tests and verification commands.
2. Review the resulting changes.
3. Update `docs/implementation-plan.md`.
4. Provide the complete end-of-phase implementation report defined below.
5. Describe the exact scope of the next phase.
6. End with:

> The current phase is complete. Shall we proceed to the next phase?

Stop there. Do not begin the next phase until the user explicitly authorizes it.

If the current phase is blocked, stop at a safe point and report:

- The exact blocker
- Evidence supporting the blocker
- Work already completed
- Any safe partial result
- The specific decision or information required from the user

Ask only the focused question necessary to unblock the work.

## Required End-of-Phase Report

The report must be factual, technically useful, and suitable for later educational review. It is an engineering work report, not a tutorial.

Use this structure.

### 1. Phase Result

Include:

- Objective
- Final status: `Completed` or `Blocked`
- Concise summary of the usable outcome

### 2. Work Completed

Describe:

- Features and components implemented
- Architectural or structural changes
- Important logic added or changed
- How the work maps to the architecture documents
- Any intentionally deferred work

### 3. Files Changed

For each important file or logical group:

- Path
- Whether it was created, modified, moved, or deleted
- Purpose
- Summary of important contents or behavior

Group generated files and repetitive mechanical changes instead of producing an unnecessarily long list.

### 4. Technical Decisions

Document:

- Decisions made during the phase
- Why each decision was necessary
- Relevant architectural requirement
- Important trade-offs or limitations
- Decisions deliberately left unresolved
- Any new ADR created or required

Do not present an architectural open decision as resolved unless the user explicitly approved it or an existing ADR already resolves it.

### 5. Commands Executed

List only commands that were actually executed, including applicable:

- Dependency installation
- Linting
- Type checking
- Unit tests
- Integration tests
- E2E tests
- Builds
- Code generation
- Database migrations
- Service startup
- Health checks

Never claim a command was executed if it was not.

### 6. Tests and Validation

Report:

- Tests added or modified
- Verification steps performed
- Results of each command
- Passed and failed test counts when available
- Errors encountered and how they were resolved
- Checks that could not run and the exact reason
- Remaining validation gaps

Do not state that everything works without supporting evidence.

### 7. Current Project State

Explain:

- What is now implemented and usable
- What can currently be run
- What remains incomplete
- Technical debt or risks introduced during this phase
- Preconditions for the next phase

### 8. Next Phase

State:

- Exact name and objective
- Expected deliverables
- Likely modules or files involved
- Known dependencies or decisions required

End with:

> The current phase is complete. Shall we proceed to the next phase?

Provide the report in the conversation. Do not create separate progress-report files unless the user explicitly requests them.

## Implementation Rules

Follow these rules throughout the project:

- Prioritize the MVP. Do not implement or scaffold out-of-scope features.
- Follow the Modular Monolith architecture and enforced module boundaries.
- Place each new file in the app or package that owns its responsibility.
- Do not place business logic in Telegram Bot handlers, the Realtime Gateway, controllers, transport adapters, or the UI.
- Do not access another module's internal files, repositories, Prisma models, or database tables directly.
- Use only documented public module surfaces, such as application ports or public `index.ts` exports.
- Keep `packages/shared` limited to genuinely shared primitives, contracts, and stable error codes.
- Keep the Coup Engine pure TypeScript, deterministic, server-authoritative, replayable, and independent of frameworks and infrastructure.
- Do not introduce NestJS, Prisma, Redis, Socket.IO, Telegram SDK, network access, storage access, `Date.now()`, or `Math.random()` into the Game Engine.
- Use explicit `Clock`, `RandomSource`, and `RuleConfig` dependencies where required.
- Keep PostgreSQL as the durable source of truth.
- Use Redis only for ephemeral state and coordination such as presence, matchmaking, rate limiting, caching, and queue infrastructure.
- Keep Match write paths atomic, version-checked, concurrency-safe, and idempotent.
- Do not perform network I/O inside database transactions.
- Publish transactional outbox messages only after the database transaction commits.
- Version public commands, events, persisted state, rulesets, job payloads, and contracts.
- Preserve compatibility for active matches and queued jobs across deployments.
- Never log or expose secrets, access tokens, Telegram `initData`, chat content, RNG material, decks, cards, hidden game state, or other players' private information.
- Treat every client message as untrusted input.
- Enforce authentication, identity, membership, roles, room state, match state, capacity, turn ownership, and game rules on the server.
- Never silently hard-code an unresolved architectural decision.
- Avoid unnecessary abstractions, dependencies, services, infrastructure, and premature generalization.
- Do not introduce Kubernetes, Kafka, Elasticsearch, or microservice deployment for the MVP.
- Do not leave permanent mocks, incomplete implementations, or untracked TODOs.
- Add and run the smallest relevant tests for every behavioral change.
- Keep changes small enough to review confidently.
- Update affected contracts and architecture documentation together with implementation when required.
- Do not commit, push, publish, deploy, or perform destructive operations unless the user explicitly requests it.

## Commands and Repository Conventions

Do not invent command names or assume scripts such as `test`, `lint`, or `build` exist.

Before running a command:

1. Inspect the root manifest and relevant package manifest.
2. Inspect the actual pnpm Workspace and Turborepo configuration.
3. Use scripts and conventions declared by the repository.
4. Prefer the smallest relevant workspace or package-level command before running the full repository pipeline.

When applicable, use the repository-defined equivalents of:

- Frozen-lockfile installation
- Linting
- Type checking
- Unit and domain tests
- Integration tests
- Build
- E2E smoke tests in an appropriate staging environment

If a required script does not exist:

- Report the gap.
- Do not pretend the script exists.
- Add a script only if doing so is genuinely part of the currently authorized bootstrap work, and document it in the phase report.

Follow existing formatting, linting, TypeScript, naming, and file-organization conventions. Do not invent new conventions unless necessary and supported by the architecture.

## Handling Ambiguity

For small, reversible implementation details that are fully consistent with the architecture, choose the simplest suitable option and document the reasoning in the phase report.

Stop and ask the user before making a decision that:

- Changes public system behavior
- Resolves an architectural open decision
- Is costly or difficult to reverse
- Materially affects security, persistence, contracts, compatibility, or deployment
- Requires product, legal, capacity, hosting, retention, or operational information that is unavailable
- Conflicts with an existing architectural rule
- Expands MVP scope

When asking for a decision, provide focused options and briefly explain the trade-off of each. Do not ask unnecessary questions when the answer can be safely determined from the repository or architecture.

## New-Conversation Startup Procedure

For every new Codex conversation:

1. Read the architecture document, `AGENTS.md`, `docs/implementation-plan.md`, and this protocol in full.
2. Inspect Git status and the relevant repository structure and code.
3. Identify the phase or subphase explicitly authorized in the user's starter prompt.
4. Verify only the prerequisites necessary for that phase.
5. Confirm that the authorized phase is consistent with the implementation plan.
6. If a prerequisite is genuinely incomplete or blocking, report it and stop.
7. Otherwise, implement only the authorized phase or subphase.
8. Run all relevant verification.
9. Update the implementation plan.
10. Provide the required end-of-phase report.
11. Stop at the mandatory phase gate.

The repository and its documentation—not previous chat history—are the persistent source of project state.
