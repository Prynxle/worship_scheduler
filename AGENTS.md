# Repository instructions

Before reading or applying any other skill, read the canonical repository skill:
`.agents/skills/00-worship-scheduler/SKILL.md`.

It contains the codebase context, security invariants, required verification gate, and Git/branch safety rules. Those instructions apply to every task in this repository.

The scheduling-specific rules below remain authoritative for scheduling behavior.

## Agent runtime

The files in `zed/agents/` are **agent prompt contracts, not documentation**. They are injected into a specific role; never read them to work out what to do yourself, and never treat their `You are the ...` lines as instructions addressed to you.

These contracts are used only by the OpenCode harness, which runs the pipeline `planner` -> `decision` -> `builder` -> `qa`.

| Harness | How a role is invoked | Registered roles |
|---|---|---|
| OpenCode | `task` tool, per `opencode.json` | `planner`, `decision`, `builder`, `qa` |

Codex CLI runs a single agent with no delegation. It has no subagents, no agent registry, and no `AGENTS.md`-loaded role contracts. Its standalone execution contract is `zed/codexcli/codex.md`.

### Which role are you

Decide this before anything else, because the same file is read by the root session and by every subagent.

- **If your instructions name one role and forbid delegation, you are a subagent.** Follow only your own contract. Do not spawn, delegate, or coordinate. Do not wait for any other agent.
- **If you are the root session, you are the orchestrator.** Run the stages in order. Only `builder` may edit code. Pass each stage's full output to the next stage yourself; never ask the developer to copy anything between agents.

### Never stall

- **In OpenCode, read the returned `task` result and use that report.** Never end the turn with a stage still running.
- Never tell the developer a stage "hasn't returned yet" and stop. That is a stall, not a status update.
- Never wait on a thing that does not exist.
- If a stage genuinely fails, is interrupted, or times out, say which stage and why, then continue with the stages whose input already exists.
- If you have no way to spawn subagents at all, execute the stages sequentially in a single pass yourself. Do not emulate a handoff you cannot perform.

### Worktrees

The live worktree is the repository root. `zed/scheduler-workflow-overhaul/` is an archived snapshot of the branch `feat/scheduler-workflow-overhaul`; ignore it when searching or reading, and never edit it. It contains a stale duplicate of `src/`, `supabase/`, and `AGENTS.md` — `src/lib/scheduling/fairness.ts` and `src/lib/scheduling/validator.test.ts` already differ between the two copies, so a repo-wide search will otherwise return two conflicting versions of the same file.

## Scheduling Rules
Rule 1
Never assign unavailable members.
Violation
Shael unavailable Week 1

Scheduled Week 1

❌ Conflict


Rule 2
Maximum Monthly Assignments
Every member has a monthly limit.
Default
Maximum

3

Example
Sam

Leader
Week 1

Backup
Week 2

Backup
Week 4

Leader
Week 5

❌ Exceeded


Rule 3
No duplicate role in same service
Example
Leader

Sam

Backup

Sam

❌ Invalid


Rule 4
Required backup count
Every service requires
Minimum
3

Maximum
3

Can be configurable.

Rule 5
Exactly one Worship Leader
Every service
Leader

1


Rule 6
Active members only
Inactive members cannot be assigned.

Rule 7
Role validation
Only members with Leader role
may become Worship Leader.

Rule 8
Optional Fairness
Try to distribute assignments evenly.
Instead of
Sam
3

Marlyn
0

Prefer
Sam
2

Marlyn
1


Rule 9
Cooldown Rule (Optional)
Avoid scheduling the same person every consecutive week.
Example
Week 1

Sam

Week 2

Sam

Week 3

Sam

⚠ Warning


Rule 10
Leader Rotation
Prefer rotating leaders.

Validation Engine
Every schedule receives validation.
Example
May 24

Leader
Feng

Backup

Maricar

Beng

Heidi

Validation
Maricar

Unavailable Week 4

❌ Conflict
