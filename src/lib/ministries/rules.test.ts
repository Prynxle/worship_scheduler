import { describe, expect, it } from 'vitest';
import { normalizeMinistryRules, resolveEffectiveBackupRange, toSchedulingRuleConfigs } from './rules';

const defaults = { min_backup: 3, max_backup: 5, max_monthly: 3 };

describe('normalizeMinistryRules', () => {
  it('normalizes display metadata and backup/assignment defaults', () => {
    const rules = normalizeMinistryRules([
      { id: 'backup', ministry_id: 'min-1', rule_type: 'backup_count', rule_config: { min_backup_singers: 3 }, severity: 'critical', is_active: true },
      { id: 'limit', ministry_id: 'min-1', rule_type: 'assignment_limit', rule_config: {}, severity: 'critical', is_active: true },
    ], defaults);

    expect(rules[0]).toMatchObject({
      name: 'Backup Count', description: 'Required number of backup members',
      rule_config: { min_required: 3, max_allowed: 5 }, is_active: true,
    });
    expect(rules[1].rule_config).toEqual({ default_max: 3 });
  });

  it('normalizes malformed rows, unknown rule types, and invalid config values safely', () => {
    const rules = normalizeMinistryRules([
      null,
      { id: 'unknown', ministry_id: 'min-1', rule_type: 'unrecognized', is_active: true },
      { id: 'backup', ministry_id: 'min-1', rule_type: 'backup_count', rule_config: { min_required: 8, max_allowed: 2 }, severity: 'other', is_active: 0 },
    ], defaults);

    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ rule_config: { min_required: 8, max_allowed: 8 }, severity: 'critical', is_active: false });
  });

  it('resolves the effective range from active rules and converts only active rows for scheduling', () => {
    const rules = normalizeMinistryRules([
      { id: 'active', ministry_id: 'min-1', rule_type: 'backup_count', rule_config: { min_required: 2, max_allowed: 4 }, severity: 'critical', is_active: true },
      { id: 'off', ministry_id: 'min-1', rule_type: 'fairness', rule_config: {}, severity: 'suggestion', is_active: false },
    ], defaults);

    expect(resolveEffectiveBackupRange(rules, defaults)).toEqual({ min: 2, max: 4 });
    expect(toSchedulingRuleConfigs(rules)).toEqual([
      { rule_type: 'backup_count', rule_config: { min_required: 2, max_allowed: 4 }, severity: 'critical', is_active: true },
    ]);
    expect(resolveEffectiveBackupRange([], defaults)).toEqual({ min: 3, max: 5 });
  });
});
