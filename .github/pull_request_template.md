## Summary

Briefly describe what this PR changes and why.

## Related Issue

Closes #

## Type of Change

- [ ] `feat` – New feature
- [ ] `fix` – Bug fix
- [ ] `docs` – Documentation only
- [ ] `style` – Code style / formatting, no logic change
- [ ] `refactor` – Code refactor, no logic change
- [ ] `perf` – Performance improvement
- [ ] `test` – Tests added or updated
- [ ] `chore` – Build / CI / tooling changes

## Verification

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Tests pass (`npm test` or relevant command)
- [ ] Scheduling validation runs for any generated/changed schedule
- [ ] No secrets or credential-shaped literals were committed

## Scheduling Rules Checklist

- [ ] Never assign unavailable members
- [ ] Never assign inactive members
- [ ] Monthly assignment limits enforced (default max 3)
- [ ] No member appears twice in the same service
- [ ] Exactly one Worship Leader per service
- [ ] Only members with Leader role are Worship Leader
- [ ] Required backup count honored (default 3)
- [ ] Validation run for every generated/changed schedule

## Notes for Reviewers

Any special instructions, follow-up work, or known limitations.
