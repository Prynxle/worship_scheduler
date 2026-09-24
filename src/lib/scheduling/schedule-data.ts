import { getAdminClient } from '@/lib/auth/server';
import { Availability, Instrument, Member, MemberRole, MemberSkill, MinistryRule, Role, ScheduleAssignment, Service } from '@/lib/types/database';
import { ScheduleContext, SchedulingRuleConfig } from '@/lib/types/scheduling';

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === 'object') : []; }
function text(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

function normalizeRules(rawRules: MinistryRule[], defaults: Record<string, number>): SchedulingRuleConfig[] {
  return rawRules.filter((rule) => rule.is_active).map((rule) => {
    const config = { ...rule.rule_config };
    if (rule.rule_type === 'backup_count') {
      const min = number(config.min_required) ?? number(config.min_backup_singers) ?? defaults.min_backup;
      const max = number(config.max_allowed) ?? number(config.max_backup_singers) ?? defaults.max_backup;
      config.min_required = min;
      config.max_allowed = Math.max(min, max);
    }
    if (rule.rule_type === 'assignment_limit') {
      config.default_max = number(config.default_max) ?? number(config.max_monthly) ?? defaults.max_monthly;
    }
    return { rule_type: rule.rule_type, rule_config: config, severity: rule.severity };
  });
}

export interface ScheduleData {
  members: Member[];
  roles: Role[];
  instruments: Instrument[];
  rules: SchedulingRuleConfig[];
  config: NonNullable<ScheduleContext['config']>;
  services: Service[];
  assignments: ScheduleAssignment[];
}

export async function loadScheduleData(churchId: string, month: number, year: number, ministryId?: string): Promise<ScheduleData> {
  const admin = getAdminClient();
  let ministryQuery = admin.from('ministries').select('id, config').eq('church_id', churchId).eq('is_active', true).order('priority', { ascending: true }).limit(1);
  if (ministryId) ministryQuery = ministryQuery.eq('id', ministryId);
  const [{ data: ministryRows, error: ministryError }, { data: church, error: churchError }, { data: memberRows, error: membersError }, { data: serviceRows, error: servicesError }] = await Promise.all([
    ministryQuery,
    admin.from('churches').select('settings').eq('id', churchId).maybeSingle(),
    admin.from('members').select('*').eq('church_id', churchId),
    admin.from('services').select('*').eq('church_id', churchId).eq('month', month).eq('year', year).order('date', { ascending: true }),
  ]);
  if (ministryError || churchError || membersError || servicesError) throw new Error('Could not load schedule data.');
  const ministry = rows(ministryRows)[0];
  if (!ministry) throw new Error('No active ministry is configured for this church.');
  const ministryUuid = text(ministry.id);
  if (!ministryUuid) throw new Error('The active ministry is invalid.');

  const memberIds = rows(memberRows).map((row) => text(row.id)).filter((id): id is string => Boolean(id));
  const [{ data: roleRows, error: rolesError }, { data: skillRows, error: skillsError }, { data: availabilityRows, error: availabilityError }, { data: rulesRows, error: rulesError }, { data: instrumentRows, error: instrumentsError }] = await Promise.all([
    admin.from('member_roles').select('*, role:roles(*)').in('member_id', memberIds),
    admin.from('member_skills').select('*, instrument:instruments(*)').in('member_id', memberIds),
    admin.from('availability').select('*').eq('church_id', churchId).in('status', ['pending', 'approved']),
    admin.from('ministry_rules').select('*').eq('ministry_id', ministryUuid),
    admin.from('instruments').select('*').eq('ministry_id', ministryUuid),
  ]);
  if (rolesError || skillsError || availabilityError || rulesError || instrumentsError) throw new Error('Could not load scheduling configuration.');

  const roles = rows(roleRows).map((row) => ({ ...row, role: row.role } as unknown as MemberRole));
  const skills = rows(skillRows).map((row) => ({ ...row, instrument: row.instrument } as unknown as MemberSkill));
  const availability = rows(availabilityRows) as unknown as Availability[];
  const members = rows(memberRows).map((row) => ({ ...row, roles: roles.filter((role) => role.member_id === row.id), skills: skills.filter((skill) => skill.member_id === row.id), availability: availability.filter((item) => item.member_id === row.id) } as unknown as Member));
  const rawRules = rows(rulesRows) as unknown as MinistryRule[];
  const settings = (church?.settings && typeof church.settings === 'object' ? church.settings : {}) as Record<string, unknown>;
  const ministryConfig = (ministry.config && typeof ministry.config === 'object' ? ministry.config : {}) as Record<string, unknown>;
  const defaults = {
    max_monthly: number(settings.default_max_monthly_assignments) ?? 3,
    min_backup: number(settings.default_min_backup_singers) ?? 3,
    max_backup: number(settings.default_max_backup_singers) ?? number(settings.default_min_backup_singers) ?? 3,
  };
  const ruleConfigs = normalizeRules(rawRules, defaults);
  if (!ruleConfigs.some((rule) => rule.rule_type === 'backup_count')) ruleConfigs.push({ rule_type: 'backup_count', rule_config: { min_required: defaults.min_backup, max_allowed: defaults.max_backup }, severity: 'critical' });
  if (!ruleConfigs.some((rule) => rule.rule_type === 'assignment_limit')) ruleConfigs.push({ rule_type: 'assignment_limit', rule_config: { default_max: defaults.max_monthly }, severity: 'critical' });
  const serviceIds = rows(serviceRows).map((row) => text(row.id)).filter((id): id is string => Boolean(id));
  const { data: assignmentRows, error: assignmentsError } = serviceIds.length
    ? await admin.from('schedule_assignments').select('*, member:members(*), role:roles(*), instrument:instruments(*)').in('service_id', serviceIds)
    : { data: [], error: null };
  if (assignmentsError) throw new Error('Could not load schedule assignments.');
  const services = rows(serviceRows) as unknown as Service[];
  const assignments = rows(assignmentRows) as unknown as ScheduleAssignment[];
  return {
    members,
    roles: rows(roleRows).map((row) => row.role).filter(Boolean) as unknown as Role[],
    instruments: rows(instrumentRows) as unknown as Instrument[],
    rules: ruleConfigs,
    config: {
      allows_dual_role: ministryConfig.allows_dual_role === true,
      cooldown_weeks: number(settings.cooldown_weeks) ?? 1,
      fairness_weights: undefined,
    },
    services,
    assignments,
  };
}
