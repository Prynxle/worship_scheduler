import type { MinistryRule, RuleType } from '@/lib/types/database';
import type { SchedulingRuleConfig } from '@/lib/types/scheduling';

export interface MinistryRuleDefaults {
  min_backup: number;
  max_backup: number;
  max_monthly: number;
}

export interface NormalizedMinistryRule {
  id: string;
  ministry_id: string;
  rule_type: RuleType;
  name: string;
  description: string;
  rule_config: Record<string, unknown>;
  severity: MinistryRule['severity'];
  is_active: boolean;
}

const RULE_PRESENTATION: Record<RuleType, { name: string; description: string }> = {
  availability_check: { name: 'Availability Check', description: 'Members must be available' },
  assignment_limit: { name: 'Assignment Limit', description: 'Monthly assignment cap' },
  role_validation: { name: 'Role Validation', description: 'Members must be qualified' },
  backup_count: { name: 'Backup Count', description: 'Required number of backup members' },
  leader_count: { name: 'Leader Count', description: 'Exactly one worship leader per service' },
  instrument_constraint: { name: 'Instrument Requirements', description: 'Required instruments and slot counts' },
  cooldown: { name: 'Cooldown', description: 'Avoid consecutive week assignments' },
  fairness: { name: 'Fairness', description: 'Distribute assignments evenly' },
  leader_rotation: { name: 'Leader Rotation', description: 'Rotate worship leaders' },
  devotion_sequence: { name: 'Devotion Sequence', description: 'Keep devotion assignments in sequence' },
  dual_role_check: { name: 'Dual Role Check', description: 'Prevent duplicate roles in one service' },
};

const RULE_TYPES = new Set(Object.keys(RULE_PRESENTATION));

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.floor(value));
}

/** Normalize stored rows once for API display and scheduling consumers. */
export function normalizeMinistryRules(
  rawRules: unknown,
  defaults: MinistryRuleDefaults,
): NormalizedMinistryRule[] {
  if (!Array.isArray(rawRules)) return [];

  return rawRules.flatMap((item): NormalizedMinistryRule[] => {
    const row = record(item);
    if (typeof row.id !== 'string' || typeof row.ministry_id !== 'string' ||
      typeof row.rule_type !== 'string' || !RULE_TYPES.has(row.rule_type)) return [];

    const ruleType = row.rule_type as RuleType;
    const ruleConfig = { ...record(row.rule_config) };
    if (ruleType === 'backup_count') {
      const min = nonNegativeInteger(finite(ruleConfig.min_required) ?? finite(ruleConfig.min_backup_singers) ?? defaults.min_backup);
      const max = nonNegativeInteger(finite(ruleConfig.max_allowed) ?? finite(ruleConfig.max_backup_singers) ?? defaults.max_backup);
      ruleConfig.min_required = min;
      ruleConfig.max_allowed = Math.max(min, max);
    }
    if (ruleType === 'assignment_limit') {
      ruleConfig.default_max = nonNegativeInteger(finite(ruleConfig.default_max) ?? finite(ruleConfig.max_monthly) ?? defaults.max_monthly);
    }

    const presentation = RULE_PRESENTATION[ruleType];
    const severity = row.severity === 'warning' || row.severity === 'suggestion' ? row.severity : 'critical';
    return [{
      id: row.id,
      ministry_id: row.ministry_id,
      rule_type: ruleType,
      name: presentation.name,
      description: presentation.description,
      rule_config: ruleConfig,
      severity,
      is_active: row.is_active === true,
    }];
  });
}

export function toSchedulingRuleConfigs(rules: NormalizedMinistryRule[]): SchedulingRuleConfig[] {
  return rules.filter((rule) => rule.is_active).map(({ rule_type, rule_config, severity }) => ({
    rule_type,
    rule_config,
    severity,
    is_active: true,
  }));
}

export function resolveEffectiveBackupRange(
  rules: NormalizedMinistryRule[],
  defaults: Pick<MinistryRuleDefaults, 'min_backup' | 'max_backup'>,
) {
  const configured = rules.find((rule) => rule.is_active && rule.rule_type === 'backup_count');
  const min = configured ? finite(configured.rule_config.min_required) ?? defaults.min_backup : defaults.min_backup;
  const max = configured ? finite(configured.rule_config.max_allowed) ?? defaults.max_backup : defaults.max_backup;
  const min_required = nonNegativeInteger(min);
  return { min: min_required, max: Math.max(min_required, nonNegativeInteger(max)) };
}
