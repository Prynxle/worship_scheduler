import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { normalizeMinistryRules, resolveEffectiveBackupRange, type MinistryRuleDefaults } from '@/lib/ministries/rules';
import type { MinistryWithConfiguration } from '@/lib/ministries/types';
import type { Instrument, Ministry, MinistryConfig, Role } from '@/lib/types/database';

type Row = Record<string, unknown>;

function record(value: unknown): Row | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function integer(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function dbRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(record).filter((row): row is Row => Boolean(row)) : [];
}

function normalizeMinistry(value: unknown, churchId: string): Ministry | null {
  const row = record(value);
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  const configRow = record(row.config) ?? {};
  const config: MinistryConfig = {
    min_members: integer(configRow.min_members, 1),
    max_members: integer(configRow.max_members, 10),
    requires_leader: configRow.requires_leader === true,
    allows_dual_role: configRow.allows_dual_role === true,
    auto_generate: configRow.auto_generate === true,
  };
  return {
    id: row.id,
    church_id: churchId,
    name: row.name,
    ...(typeof row.description === 'string' ? { description: row.description } : {}),
    config,
    priority: integer(row.priority, 1),
    is_active: row.is_active === true,
    created_at: text(row.created_at) ?? '',
  };
}

function normalizeRole(value: unknown): Role | null {
  const row = record(value);
  if (!row || typeof row.id !== 'string' || typeof row.ministry_id !== 'string' || typeof row.name !== 'string') return null;
  const min_required = integer(row.min_required, 0);
  return {
    id: row.id,
    ministry_id: row.ministry_id,
    name: row.name,
    ...(typeof row.description === 'string' ? { description: row.description } : {}),
    min_required,
    max_allowed: Math.max(min_required, integer(row.max_allowed, 10)),
    priority: integer(row.priority, 1),
    is_active: row.is_active === true,
    created_at: text(row.created_at) ?? '',
  };
}

function normalizeInstrument(value: unknown): Instrument | null {
  const row = record(value);
  if (!row || typeof row.id !== 'string' || typeof row.ministry_id !== 'string' || typeof row.name !== 'string') return null;
  const min_count = integer(row.min_count, 1);
  return {
    id: row.id,
    ministry_id: row.ministry_id,
    name: row.name,
    ...(typeof row.description === 'string' ? { description: row.description } : {}),
    is_required: row.is_required === true,
    min_count,
    max_count: Math.max(min_count, integer(row.max_count, 1)),
    slot_counts: row.slot_counts === true,
    created_at: text(row.created_at) ?? '',
  };
}

function settingsDefaults(value: unknown): MinistryRuleDefaults {
  const settings = record(value) ?? {};
  return {
    min_backup: integer(settings.default_min_backup_singers, 3),
    max_backup: integer(settings.default_max_backup_singers, 5),
    max_monthly: integer(settings.default_max_monthly_assignments, 3),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const admin = getAdminClient();
  const [{ data: ministryRows, error: ministriesError }, { data: church, error: churchError }] = await Promise.all([
    admin.from('ministries').select('*').eq('church_id', auth.churchId).order('priority', { ascending: true }),
    admin.from('churches').select('settings').eq('id', auth.churchId).maybeSingle(),
  ]);
  if (ministriesError || churchError) {
    return NextResponse.json({ error: 'Could not load ministry configuration.' }, { status: 500 });
  }

  const ministries = dbRows(ministryRows)
    .map((row) => normalizeMinistry(row, auth.churchId))
    .filter((ministry): ministry is Ministry => ministry !== null);
  if (ministries.length === 0) return NextResponse.json({ ministries: [] });

  // Roles, instruments, and rules have no church_id column. Their ministry_id
  // filter is derived exclusively from the authenticated church's ministries.
  const ministryIds = ministries.map(({ id }) => id);
  const [{ data: roleRows, error: rolesError }, { data: instrumentRows, error: instrumentsError }, { data: ruleRows, error: rulesError }] = await Promise.all([
    admin.from('roles').select('*').in('ministry_id', ministryIds).order('priority', { ascending: true }),
    admin.from('instruments').select('*').in('ministry_id', ministryIds).order('name', { ascending: true }),
    admin.from('ministry_rules').select('*').in('ministry_id', ministryIds),
  ]);
  if (rolesError || instrumentsError || rulesError) {
    return NextResponse.json({ error: 'Could not load ministry configuration.' }, { status: 500 });
  }

  const defaults = settingsDefaults(church?.settings);
  const roles = dbRows(roleRows).map(normalizeRole).filter((role): role is Role => role !== null);
  const instruments = dbRows(instrumentRows).map(normalizeInstrument).filter((instrument): instrument is Instrument => instrument !== null);
  const rules = normalizeMinistryRules(ruleRows, defaults);
  const response: MinistryWithConfiguration[] = ministries.map((ministry) => {
    const ministryRules = rules.filter((rule) => rule.ministry_id === ministry.id);
    return {
      ...ministry,
      roles: roles.filter((role) => role.ministry_id === ministry.id),
      instruments: instruments.filter((instrument) => instrument.ministry_id === ministry.id),
      rules: ministryRules,
      effective_backup_range: resolveEffectiveBackupRange(ministryRules, defaults),
    };
  });

  return NextResponse.json({ ministries: response });
}
