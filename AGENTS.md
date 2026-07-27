Scheduling Rules
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
