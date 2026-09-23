# Worship Scheduler — Schedule Generation Algorithm Context

## 1. Purpose

The Worship Scheduler generates complete worship-service schedules while respecting mandatory scheduling constraints and attempting to distribute assignments fairly across eligible members.

The generator must not behave like a simple round-robin queue such as:

```text
X → Y → Z → A → B → C → X → Y → Z ...
```

A fixed queue is too rigid because member availability, role qualifications, monthly limits, existing assignments, cooldowns, and other constraints can change from week to week.

Instead, the scheduler should use a **constraint-aware, fairness-driven assignment algorithm**.

The core philosophy is:

> **Hard constraints determine who CAN be assigned. Soft constraints determine who SHOULD be preferred. Historical assignment state prevents fairness from resetting when a new month begins.**

---

# 2. Scheduling Model

A schedule consists of multiple services. Each service contains several required assignment slots.

Typical service structure:

```text
Service
├── Worship Leader × 1
├── Backup × 3
├── Devotion × 1
├── Drums × 1
├── Bass × 1
├── Piano × 1
└── Guitar × 1
```

The number of backups and other role requirements may be configurable.

The scheduler should treat each required position as an individual **assignment slot**.

Example:

```text
Week 1
├── Leader
├── Backup 1
├── Backup 2
├── Backup 3
├── Devotion
├── Drums
├── Bass
├── Piano
└── Guitar
```

---

# 3. Core Scheduling Rules

## 3.1 Hard Constraints

Hard constraints are rules that **must never be violated**.

A candidate must be rejected if assigning them would violate any mandatory rule.

### Rule 1 — Availability

Never assign a member when they are unavailable for that service/week.

```text
Shael
Availability:
Week 1 = unavailable

Result:

Week 1 → Shael ❌
```

Availability is an absolute constraint.

---

### Rule 2 — Monthly Assignment Limit

Every member has a configurable maximum number of assignments per month.

Default:

```text
Maximum monthly assignments = 3
```

Example:

```text
Sam
Week 1 → Leader
Week 2 → Backup
Week 4 → Backup

Monthly assignments = 3
```

Sam cannot receive another assignment during that month if the limit is 3.

The monthly limit applies to the member's total assignments unless the configuration explicitly defines role-specific limits.

---

### Rule 3 — No Duplicate Role in the Same Service

A member cannot occupy the same role multiple times in the same service.

Example:

```text
Leader  → Sam
Backup  → Sam
```

If the system allows a person to hold only one assignment per service, this becomes an even stronger rule:

```text
Sam → Leader
Sam → Backup ❌
```

The exact policy should be represented explicitly in scheduler configuration.

---

### Rule 4 — Required Backup Count

Every service must contain the configured number of backups.

Default:

```text
Minimum backups = 3
Maximum backups = 3
```

The generator must not produce:

```text
Backup 1
Backup 2
```

when three backups are required.

---

### Rule 5 — Exactly One Worship Leader

Every service must contain exactly one Worship Leader.

```text
Leader = 1
```

Invalid:

```text
Leader → Sam
Leader → John
```

Valid:

```text
Leader → Sam
```

---

### Rule 6 — Active Members Only

Inactive members cannot receive assignments.

```text
member.active === false
```

means:

```text
eligible = false
```

---

### Rule 7 — Role Qualification

A member must be qualified for the role they are being considered for.

Example:

```text
Member role permissions:
Leader = false

Candidate for Worship Leader:
→ rejected
```

The scheduler must never assign someone to a role they are not qualified to perform.

---

# 4. Soft Constraints

Soft constraints do not make an assignment invalid.

Instead, they affect the candidate's priority.

The scheduler should attempt to satisfy these constraints whenever possible.

## Rule 8 — Fairness

Assignments should be distributed as evenly as reasonably possible.

Bad distribution:

```text
Sam    → 3
Marlyn → 0
John   → 0
```

More balanced:

```text
Sam    → 2
Marlyn → 1
John   → 0
```

Fairness does not override hard constraints.

If only Sam is eligible, Sam may still be assigned repeatedly.

---

## Rule 9 — Cooldown

Avoid assigning the same member in consecutive weeks when reasonable.

Example:

```text
Week 1 → Sam
Week 2 → Sam
Week 3 → Sam
```

This should receive a significant fairness penalty.

However, cooldown is not an absolute prohibition unless explicitly configured as a hard rule.

---

## Rule 10 — Leader Rotation

The scheduler should prefer rotating Worship Leaders.

Example:

```text
Week 1 → Sam
Week 2 → John
Week 3 → Marlyn
Week 4 → Alex
```

rather than repeatedly assigning:

```text
Week 1 → Sam
Week 2 → Sam
Week 3 → Sam
Week 4 → Sam
```

Leader rotation is a preference, not an excuse to violate availability, qualifications, or assignment limits.

---

# 5. Critical Design Principle: Do Not Reset Fairness Every Month

A naive monthly scheduler might do this:

```text
Month 1:
X → Y → Z → A → B → C

Month 2:
X → Y → Z → A → B → C

Month 3:
X → Y → Z → A → B → C
```

This creates artificial rotation based only on the member list.

The scheduler should instead maintain assignment history.

Example:

```text
Recent assignment history:

X = 8 assignments
Y = 6 assignments
Z = 5 assignments
A = 3 assignments
B = 4 assignments
C = 3 assignments
```

When the new month begins, the algorithm still knows that X has received substantially more assignments recently.

Therefore, A/C/Z may receive stronger preference when they are eligible.

### Important

The beginning of a new calendar month must **not automatically reset long-term fairness**.

The monthly assignment limit can reset.

The member's historical fairness state should not.

---

# 6. Assignment History

Each member should have historical scheduling state.

Conceptually:

```text
Member
├── totalAssignments
├── recentAssignments
├── currentMonthAssignments
├── lastAssignedDate
├── lastAssignedWeek
├── consecutiveAssignments
├── roleHistory
│   ├── leader
│   ├── backup
│   ├── devotion
│   ├── drums
│   ├── bass
│   ├── piano
│   └── guitar
└── recentRoleHistory
```

Example:

```text
Member X

Total assignments: 8
Current month: 1
Last assigned: Week 2
Consecutive assignments: 0

Role history:
Leader: 1
Backup: 4
Devotion: 1
Drums: 0
Bass: 1
Piano: 1
Guitar: 0
```

This allows the scheduler to distinguish:

```text
"X has received many assignments"
```

from:

```text
"X has received many Backup assignments specifically."
```

---

# 7. Role-Specific Fairness

Fairness should exist at two levels:

## Overall workload

How many assignments has the member received?

```text
X = 5
Y = 3
Z = 2
```

## Role workload

How frequently has the member received a particular role?

```text
X
├── Leader = 1
├── Backup = 4
├── Devotion = 0
└── Piano = 0
```

This prevents a member from being repeatedly assigned the same role even when their overall assignment count looks acceptable.

For example:

```text
X total assignments = 4

Leader = 0
Backup = 4
```

The scheduler should recognize that X has been heavily used as a Backup.

---

# 8. Candidate Selection

For every assignment slot, the scheduler should follow this process.

```text
Assignment Slot
      ↓
Find all members
      ↓
Apply hard constraints
      ↓
Remove invalid candidates
      ↓
Calculate fairness score
      ↓
Rank candidates by score
      ↓
Select preferred valid candidate
      ↓
Update temporary schedule state
```

Example:

```text
Backup — Week 3

Members:
X Y Z A B C
```

After hard-constraint filtering:

```text
X → eligible
Y → eligible
Z → unavailable
A → eligible
B → monthly limit reached
C → inactive
```

Candidate pool:

```text
X
Y
A
```

The scheduler then scores X, Y, and A.

---

# 9. Candidate Scoring

The exact weights should be configurable rather than hardcoded into the business logic.

Conceptually:

```text
Candidate Score =
    Monthly Workload Penalty
  + Historical Workload Penalty
  + Recent Assignment Penalty
  + Consecutive Week Penalty
  + Same Role Penalty
  + Leader Rotation Penalty
```

Lower score means stronger preference.

A conceptual example:

```text
Candidate X
├── Monthly workload       +20
├── Historical workload    +10
├── Recent assignment      +15
├── Consecutive assignment +20
└── Same-role history      +10
                         = 75
```

```text
Candidate A
├── Monthly workload       +0
├── Historical workload    +2
├── Recent assignment      +0
├── Consecutive assignment +0
└── Same-role history      +0
                         = 2
```

A would therefore be preferred.

The actual numeric values are implementation details and should be tuned through testing.

---

# 10. Do Not Use a Fixed Role Order as the Only Scheduling Strategy

A simple implementation might generate:

```text
1. Leader
2. Backup
3. Devotion
4. Drums
5. Bass
6. Piano
7. Guitar
```

This is understandable and can work for simple cases.

However, a stronger algorithm should prioritize **the most constrained assignment slots**.

Example:

```text
Leader:
2 eligible members

Piano:
3 eligible members

Backup:
8 eligible members

Guitar:
7 eligible members
```

The scheduler should consider the most constrained slots first.

Therefore:

```text
Leader
↓
Piano
↓
Backup
↓
Guitar
```

rather than blindly following role order.

This is a **Most Constrained First** strategy.

The principle is:

> Assign the hardest-to-fill slots first while the largest candidate pool is still available.

This reduces the chance that easy assignments consume members needed for difficult roles.

---

# 11. Recommended Generation Strategy

## Phase 1 — Load Scheduling Context

Load:

```text
Members
Availability
Roles
Qualifications
Monthly limits
Existing assignment history
Scheduling configuration
Services to generate
```

---

## Phase 2 — Build Assignment Slots

Convert the requested schedule into individual slots.

Example:

```text
Week 1
├── Leader
├── Backup ×3
├── Devotion
├── Drums
├── Bass
├── Piano
└── Guitar

Week 2
├── Leader
├── Backup ×3
├── Devotion
├── Drums
├── Bass
├── Piano
└── Guitar
```

---

## Phase 3 — Determine Slot Difficulty

For each slot, determine how many members are currently eligible.

Example:

```text
Week 1 Leader → 2 candidates
Week 1 Piano  → 3 candidates
Week 1 Drums  → 6 candidates
Week 1 Backup → 8 candidates
```

Prioritize slots with fewer candidates.

---

## Phase 4 — Generate Candidate Pool

For each slot:

```text
All members
    ↓
Active?
    ↓
Available?
    ↓
Qualified for role?
    ↓
Monthly limit available?
    ↓
Already assigned in this service?
    ↓
Eligible candidate
```

Only candidates passing all hard constraints enter scoring.

---

## Phase 5 — Score Candidates

Evaluate:

```text
Current monthly workload
Historical workload
Recent workload
Consecutive assignment count
Role-specific workload
Cooldown
Leader rotation
Other configured fairness preferences
```

---

## Phase 6 — Select Candidate

Choose the valid candidate with the strongest fairness score.

If multiple candidates have effectively equal scores, use a deterministic tie-breaker or controlled randomization.

Possible tie-breakers:

```text
1. Lowest recent workload
2. Longest time since last assignment
3. Lowest role-specific workload
4. Stable member ID / deterministic ordering
```

Controlled randomization may also be used if reproducibility is not required.

---

## Phase 7 — Update Temporary State

Immediately update the in-memory schedule state.

Example:

```text
X assigned as Backup in Week 2
```

Update:

```text
X.monthAssignments += 1
X.totalAssignments += 1
X.lastAssignedWeek = Week 2
X.consecutiveAssignments += 1
X.roleHistory.backup += 1
```

This is critical.

The next assignment must see the updated state.

---

# 12. Monthly Fairness Example

Assume:

```text
Members:
X Y Z A B C

Backups per service:
3
```

Do NOT use:

```text
Week 1 → X Y Z
Week 2 → A B C
Week 3 → X Y Z
Week 4 → A B C
```

Instead, use the current assignment state.

### Week 1

All members have equal workload.

Possible result:

```text
X Y Z
```

State:

```text
X = 1
Y = 1
Z = 1
A = 0
B = 0
C = 0
```

### Week 2

The scheduler prefers the lower-workload members:

```text
A B C
```

State:

```text
X = 1
Y = 1
Z = 1
A = 1
B = 1
C = 1
```

### Week 3

Everyone has equal workload.

Now cooldown and historical state become relevant.

The scheduler should not automatically choose X Y Z again simply because they appeared first in the member list.

It evaluates:

```text
Who was assigned recently?
Who has been assigned to Backup recently?
Who has received more total assignments?
Who has been waiting longest?
Who is eligible?
```

The result is therefore determined by the current scheduling state rather than a static sequence.

---

# 13. Cross-Month Example

Suppose Month 1 ends with:

```text
X = 5
Y = 4
Z = 4
A = 2
B = 2
C = 1
```

Month 2 begins.

The monthly counters reset:

```text
Current month:
X = 0
Y = 0
Z = 0
A = 0
B = 0
C = 0
```

But historical workload remains:

```text
Recent history:
X = 5
Y = 4
Z = 4
A = 2
B = 2
C = 1
```

Therefore, the algorithm still recognizes that X has historically received more assignments.

This prevents:

```text
Month 1 → X heavily scheduled
Month 2 → X immediately scheduled heavily again
```

The monthly limit resets, but **fairness history does not**.

---

# 14. Generation and Validation Must Be Separate

The generator should not be the final authority.

Architecture:

```text
GENERATOR
    ↓
Produces proposed schedule
    ↓
VALIDATION ENGINE
    ↓
Valid?
 ┌──┴──┐
YES    NO
 ↓      ↓
Done   Repair
        ↓
     Revalidate
```

The validation engine should independently verify every mandatory rule.

This protects against bugs in the generation algorithm.

---

# 15. Validation Checklist

Every generated schedule should be checked for:

```text
[ ] No unavailable members
[ ] No inactive members
[ ] No member exceeds monthly limit
[ ] Required backup count satisfied
[ ] Exactly one Worship Leader per service
[ ] Every assigned role is valid for the member
[ ] No prohibited duplicate assignment in the same service
[ ] All required service roles are filled
[ ] No scheduling conflicts
[ ] Fairness metrics calculated
[ ] Cooldown violations identified
[ ] Leader rotation evaluated
```

Hard-rule failures should make the schedule invalid.

Soft-rule violations should be reported as warnings or optimization opportunities unless configured otherwise.

---

# 16. Repair / Reassignment Strategy

If validation finds a conflict, do not immediately regenerate the entire schedule.

First identify the affected assignment.

Example:

```text
Week 4
Piano → X

Validation:
X became unavailable
```

Repair:

```text
Find alternative Piano candidates
        ↓
Filter hard constraints
        ↓
Score candidates
        ↓
Choose best replacement
        ↓
Update schedule
        ↓
Validate again
```

This minimizes unnecessary changes.

---

# 17. Local Repair vs Full Regeneration

Use **local repair** when possible.

Example:

```text
One conflict
↓
Replace one assignment
↓
Revalidate
```

Use broader regeneration when:

```text
No eligible replacement exists
OR
Multiple cascading conflicts exist
OR
The schedule cannot satisfy required constraints
```

This produces more stable schedules and avoids unnecessarily changing assignments that were already valid.

---

# 18. Important State Separation

The scheduler should distinguish between:

## Persistent history

Information that exists outside the current generation:

```text
Historical assignments
Member role history
Past service assignments
Long-term workload
```

## Generation state

Temporary information for the schedule currently being generated:

```text
Assignments already made
Current-month count
Current-service assignments
Current cooldown state
Temporary candidate availability
```

The generator should work against a **temporary scheduling state** and only persist the final schedule after validation succeeds.

---

# 19. Determinism

The same input should ideally produce the same schedule.

For example:

```text
Same members
Same availability
Same history
Same configuration
Same target dates
```

should produce the same result.

This makes debugging and QA significantly easier.

If randomized tie-breaking is introduced, use a controlled seed so the schedule can be reproduced.

---

# 20. Failure Handling

The scheduler must be able to report when a schedule is impossible.

Example:

```text
Week 3 — Worship Leader

Required:
1

Eligible:
0

Reason:
All qualified leaders are either unavailable,
inactive, or at their monthly assignment limit.
```

Do not silently violate a rule just to produce a schedule.

The scheduler should return a structured failure explaining:

```text
Service
Date/week
Role
Required slots
Eligible candidates
Rejected candidates
Reasons for rejection
```

Example:

```text
Scheduling Failure

Week: 3
Role: Worship Leader

Required: 1
Eligible: 0

Candidates rejected:
- Sam → unavailable
- John → monthly limit reached
- Alex → not qualified for Leader
- Mark → inactive
```

---

# 21. Recommended High-Level Algorithm

```text
function generateSchedule(input):

    load members
    load availability
    load historical assignment history
    load scheduling configuration

    build all required service slots

    initialize temporary scheduling state

    while unfilled slots exist:

        determine currently eligible candidates
        for each unfilled slot

        identify most constrained slot

        filter candidates using HARD constraints

        if no candidates exist:
            attempt repair/backtracking

            if no valid solution exists:
                return scheduling failure

        score remaining candidates

        select best candidate

        assign candidate to slot

        update temporary state

    validate complete schedule

    if validation fails:

        identify affected assignments

        attempt local repair

        validate again

        if repair fails:
            backtrack or regenerate affected portion

    calculate fairness metrics

    return validated schedule
```

---

# 22. Recommended Scoring Architecture

Do not hardcode the scoring formula directly into role-generation functions.

Use a configurable scoring system.

Conceptually:

```text
FairnessScorer
├── monthlyWorkloadScore
├── historicalWorkloadScore
├── recentWorkloadScore
├── consecutiveAssignmentScore
├── roleWorkloadScore
├── cooldownScore
├── leaderRotationScore
└── calculateTotalScore()
```

This allows the organization to adjust scheduling behavior without rewriting the core generator.

Example configuration:

```text
fairness:
    monthlyWorkloadWeight
    historicalWorkloadWeight
    recentWorkloadWeight
    cooldownWeight
    roleWorkloadWeight
    leaderRotationWeight
```

The exact weights should be validated through testing rather than assumed to be universally optimal.

---

# 23. Recommended Scheduling Priority

The preferred conceptual priority is:

```text
1. Satisfy hard constraints
2. Fill the most constrained slots
3. Minimize current workload imbalance
4. Minimize recent/repeated assignments
5. Maintain long-term fairness
6. Rotate roles where practical
7. Preserve stable existing assignments
```

The ordering can be refined during implementation, but hard constraints must always remain above optimization preferences.

---

# 24. Example Final Schedule

Example:

```text
Week 1
Leader    → X
Backup    → A
Backup    → B
Backup    → C
Devotion  → Y
Drums     → Z
Bass      → X
Piano     → A
Guitar    → B

Week 2
Leader    → Y
Backup    → D
Backup    → E
Backup    → F
Devotion  → Z
Drums     → A
Bass      → B
Piano     → C
Guitar    → D
```

The exact result is not predetermined.

It is produced from:

```text
Eligibility
+
Availability
+
Qualifications
+
Monthly limits
+
Historical workload
+
Role history
+
Cooldown
+
Rotation
+
Current schedule state
```

---

# 25. Core Principle for Implementation

The scheduler should NOT think:

```text
"Whose turn is it?"
```

It should think:

```text
"Who is currently eligible,
who has the lowest scheduling burden,
who has waited the longest,
who has recently performed this role,
and who can be assigned without compromising the rest of the schedule?"
```

This distinction is the foundation of the algorithm.

---

# 26. Final Architecture

```text
                    ┌─────────────────────┐
                    │ Scheduling Input     │
                    ├─────────────────────┤
                    │ Members             │
                    │ Availability        │
                    │ Qualifications      │
                    │ Limits              │
                    │ History             │
                    │ Configuration       │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Build Service Slots │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Slot Difficulty     │
                    │ / Constraint Check  │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Candidate Filtering │
                    │ HARD CONSTRAINTS    │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Candidate Scoring   │
                    │ SOFT CONSTRAINTS    │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Assignment          │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ Update Temp State   │
                    └──────────┬──────────┘
                               │
                         More slots?
                          /        \
                        YES         NO
                         │           │
                         └─────┐     ↓
                               │  VALIDATION
                               │     │
                               │   Valid?
                               │   /    \
                               │ YES    NO
                               │  │      │
                               │  │   REPAIR
                               │  │      │
                               │  │   REVALIDATE
                               │  │      │
                               └──┴──────┘
                                      ↓
                              FINAL SCHEDULE
```

---

# 27. Summary

The Worship Scheduler should be implemented as a **constraint-aware scheduling optimizer**, not a simple round-robin assignment system.

The key design decisions are:

1. **Hard constraints are absolute.**
2. **Soft constraints influence candidate preference.**
3. **Assignment history persists across months.**
4. **Monthly limits reset, but long-term fairness does not.**
5. **Track both total assignments and role-specific assignments.**
6. **Use cooldown and leader rotation to prevent repetitive scheduling.**
7. **Prioritize the most constrained slots first.**
8. **Score eligible candidates instead of following a fixed member order.**
9. **Maintain temporary scheduling state during generation.**
10. **Run an independent validation engine after generation.**
11. **Repair individual conflicts before regenerating the entire schedule.**
12. **Explicitly report impossible scheduling situations instead of violating rules.**
13. **Keep scoring weights configurable.**
14. **Prefer deterministic generation for easier QA and debugging.**

The desired behavior is therefore:

```text
NOT:

X → Y → Z → A → B → C

BUT:

Find valid candidates
        ↓
Measure current workload
        ↓
Consider historical workload
        ↓
Consider role history
        ↓
Consider cooldown
        ↓
Consider rotation
        ↓
Choose the fairest valid candidate
        ↓
Update state
        ↓
Repeat
```

This gives the scheduler **long-term fairness, constraint safety, role awareness, and adaptability** while keeping the generation logic separate from the validation authority.
