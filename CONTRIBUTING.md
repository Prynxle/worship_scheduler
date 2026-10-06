# Contributing to Worship Scheduler

Thank you for your interest in contributing to the Worship Scheduler project. This document provides guidelines to help you make effective contributions.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Branching & Merging](#branching--merging)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Scheduling Invariants](#scheduling-invariants)
- [Code Quality](#code-quality)
- [Security & Privacy](#security--privacy)
- [Reporting Issues](#reporting-issues)
- [Getting Help](#getting-help)

## Code of Conduct

Please be respectful and constructive in all interactions.

## Getting Started

1. **Read the Repository Rules**
   - `AGENTS.md` contains the authoritative scheduling rules and repository constraints.
   - `.agents/skills/00-worship-scheduler/SKILL.md` contains codebase context, security invariants, and verification gates.

2. **Set Up Your Environment**
   ```bash
   npm install
   npm run dev
   ```

3. **Understand the Agent Runtime**
   - The project uses an orchestrated agent pipeline: Planner → Decision → Builder → QA.
   - Do not modify scheduling logic without going through the proper validation path.

## Development Workflow

For any non-trivial change:

1. **Planner** produces an implementation plan (`READY`, `NEEDS_CLARIFICATION`, or `BLOCKED`).
2. **Decision** assesses architecture, correctness, and risk.
3. **Builder** implements only an approved plan.
4. **QA** independently verifies hard rules and behavior.
5. **Planner Final Approval** issues the verdict.

If a stage returns `NEEDS_CLARIFICATION`, `BLOCKED`, or `FAIL`, resolve the issue before proceeding.

## Branching & Merging

- Use descriptive branch names:
  - `feature/short-description`
  - `bugfix/issue-number-short-description`
  - `hotfix/critical-fix`
- Never commit directly to `main` or `master`.
- Keep your branch focused on a single logical change.
- Rebase or merge frequently to stay up to date.

## Commit Messages

- Use clear, concise messages.
- Format: `<type>(<scope>): <description>`
  - Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- Example: `feat(scheduler): enforce max backups per service`

> **Important:** Do not add AI attribution to commit messages, PR descriptions, or issues. Describe the engineering work only.

## Pull Requests

- Title should be concise and descriptive.
- Description must explain:
  - What changed
  - Why it changed
  - How it was verified
- Link any related issues.
- Ensure all checks pass before requesting review.
- Remove any AI attribution footers from existing PRs.

## Scheduling Invariants

Treat these as hard constraints unless explicitly configurable:

- Never assign unavailable members.
- Never assign inactive members.
- Enforce each member's monthly assignment limit (default max 3).
- Never assign one member twice in the same service, regardless of role.
- Require exactly one Worship Leader per service.
- Only members with the Leader role may be Worship Leader.
- Require 3 backups per service by default; honor configured minimum/maximum.
- Run validation for every generated or changed schedule.

Fairness, cooldown, and leader rotation are optimization rules and must not override hard constraints.

## Code Quality

- Run linting, tests, and the production build before committing:
  ```bash
  npm run lint
  npm test
  npm run build
  ```
- Write tests for scheduling logic.
- Keep UI/components accessible and responsive.
- Avoid introducing new dependencies without discussion.

## Security & Privacy

- Never commit secrets, tokens, or `.env` values.
- Scan changed files for credential-shaped literals before committing.
- Report any matched credentials rather than assuming they are benign.

## Reporting Issues

- Use GitHub Issues.
- Provide:
  - Clear description
  - Steps to reproduce
  - Expected vs actual behavior
  - Screenshots or logs if applicable
- Tag issues appropriately (e.g., `bug`, `enhancement`, `scheduling`).

## Getting Help

- Check `AGENTS.md` and `.agents/skills/00-worship-scheduler/SKILL.md` first.
- Open a draft issue for discussion before starting large work.
- Reach out to maintainers via GitHub discussions or team channels.

---

By contributing, you agree to follow these guidelines.
