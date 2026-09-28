import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { SchedulingEngine } from '@/lib/scheduling/engine';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { formatLocalDate, getWeeksInMonth, getWeekDate } from '@/lib/utils/date-utils';
import { ScheduleContext, SchedulingFailureError, GeneratedService } from '@/lib/types/scheduling';
import { Instrument, Member, Role, ScheduleAssignment, Service } from '@/lib/types/database';
import { isBackupRoleName, isDevotionRoleName, isInstrumentalistRoleName, isWorshipLeaderRoleName, matchesInstrumentName } from '@/lib/scheduling/role-classifier';

function parseMonthYear(request: Request, body?: Record<string, unknown>) {
  const url = new URL(request.url);
  const monthValue = body?.month ?? (url.searchParams.get('month') === null ? new Date().getMonth() : Number(url.searchParams.get('month')));
  const yearValue = body?.year ?? (url.searchParams.get('year') === null ? new Date().getFullYear() : Number(url.searchParams.get('year')));
  if (typeof monthValue !== 'number' || !Number.isInteger(monthValue) || monthValue < 0 || monthValue > 11 || typeof yearValue !== 'number' || !Number.isInteger(yearValue) || yearValue < 2000 || yearValue > 2100) throw new Error('Month must be 0-11 and year must be between 2000 and 2100.');
  return { month: monthValue, year: yearValue };
}

function serviceAssignments(service: Service, assignments: ScheduleAssignment[]) {
  const own = assignments.filter((assignment) => assignment.service_id === service.id);
  const leader = own.find((assignment) => assignment.is_leader)?.member;
  return { id: service.id, church_id: service.church_id, date: service.date, week_number: service.week_number, leader_name: leader?.full_name ?? 'Unassigned', leader_avatar: leader?.avatar_url, backup_singers: own.filter((assignment) => !assignment.is_leader && assignment.role && isBackupRoleName(assignment.role.name)).map((assignment) => ({ name: assignment.member?.full_name ?? 'Unassigned', avatar: assignment.member?.avatar_url })), instrumentalists: own.filter((assignment) => assignment.instrument).map((assignment) => ({ instrument: assignment.instrument?.name ?? 'Instrument', name: assignment.member?.full_name ?? 'Unassigned' })), devotion_name: own.find((assignment) => assignment.role && isDevotionRoleName(assignment.role.name))?.member?.full_name, status: service.status === 'archived' ? 'draft' : service.status, conflict_count: 0 };
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  try { const { month, year } = parseMonthYear(request); const data = await loadScheduleData(auth.churchId, month, year); return NextResponse.json({ services: data.services.map((service) => serviceAssignments(service, data.assignments)), month, year, church_id: auth.churchId }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load schedules.' }, { status: 400 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 });
    const { month, year } = parseMonthYear(request, body);
    const count = getWeeksInMonth(month, year);
    const requested = body.week_numbers;
    const weekNumbers = requested === undefined ? Array.from({ length: count }, (_, index) => index + 1) : requested;
    if (!Array.isArray(weekNumbers) || weekNumbers.length === 0 || weekNumbers.some((week) => typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > count)) return NextResponse.json({ error: 'week_numbers must contain valid weeks for the requested month.' }, { status: 400 });
    const data = await loadScheduleData(auth.churchId, month, year, typeof body.ministry_id === 'string' ? body.ministry_id : undefined);
    const selected = new Set(weekNumbers);
    const protectedServices = data.services.filter((service) => selected.has(service.week_number) && ['published', 'validated'].includes(service.status));
    if (protectedServices.length) return NextResponse.json({ error: 'Published or validated services cannot be regenerated.', service_ids: protectedServices.map((service) => service.id) }, { status: 409 });
    const replaceable = new Set(data.services.filter((service) => selected.has(service.week_number)).map((service) => service.id));
    const historicalAssignments = data.assignments.filter((assignment) => !replaceable.has(assignment.service_id));
    const firstWeek = weekNumbers[0];
    const context: ScheduleContext = { service: { id: 'generation', church_id: auth.churchId, date: formatLocalDate(getWeekDate(firstWeek, month, year)), week_number: firstWeek, month, year, service_type: 'sunday', status: 'draft', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, church_id: auth.churchId, month, year, week_number: firstWeek, week_numbers: weekNumbers, existing_assignments: historicalAssignments, historical_assignments: data.assignments, available_members: data.members, all_members: data.members, rules: data.rules, config: data.config };
    const generated = await new SchedulingEngine(context).generateSchedule();
    await persistGeneratedSchedule(auth.userId, auth.churchId, month, year, generated, data, replaceable);
    return NextResponse.json({ services: generated, validation: generated.flatMap((service) => service.conflicts), month, year }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    if (error instanceof SchedulingFailureError) return NextResponse.json({ services: [], validation: [], failures: error.failures }, { status: 422 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not generate schedule.' }, { status: 400 });
  }
}

async function persistGeneratedSchedule(userId: string, churchId: string, month: number, year: number, generated: GeneratedService[], data: Awaited<ReturnType<typeof loadScheduleData>>, replaceable: Set<string>) {
  // There is no transaction here, so every role must be resolved BEFORE the
  // first mutation. Otherwise an unresolvable role would delete the existing
  // draft month, leave a partially written month behind, and still 400.
  const plans = generated.map((generatedService) => ({ generatedService, resolved: resolveAssignments(generatedService) }));
  const now = new Date().toISOString();
  const admin = getAdminClient();
  if (replaceable.size) { const { error } = await admin.from('services').delete().in('id', [...replaceable]).eq('church_id', churchId); if (error) throw new Error('Could not replace existing draft services.'); }
  for (const { generatedService, resolved } of plans) {
    const { data: service, error: serviceError } = await admin.from('services').insert({ church_id: churchId, date: generatedService.date, week_number: generatedService.week_number, month, year, service_type: 'sunday', status: 'draft', generated_by: userId }).select('*').single<Service>();
    if (serviceError || !service) throw new Error('Could not save generated service.');
    const { error: assignmentError } = await admin.from('schedule_assignments').insert(assignmentRowsFor(service, resolved, userId, now));
    if (assignmentError) throw new Error('Could not save generated assignments.');
  }
}

interface ResolvedAssignment { memberId: string; roleId: string; instrumentId: string | undefined; isLeader: boolean; }

function roleFor(member: Member | null, predicate: (role: Role) => boolean): Role | undefined { return member?.roles?.map((item) => item.role).find((role) => role ? predicate(role) : false); }

// Union of both pre-classifier instrument clauses, most specific first: the
// instrument-name match the writer always had, then the shared instrument-role
// classifier that additionally accepts 'Instrumentalist'.
function instrumentRoleFor(member: Member | null, instrument: Instrument): Role | undefined {
  return roleFor(member, (role) => matchesInstrumentName(role.name, instrument.name)) ?? roleFor(member, (role) => isInstrumentalistRoleName(role.name));
}

function resolveAssignments(generated: GeneratedService): ResolvedAssignment[] {
  const resolved: ResolvedAssignment[] = [];
  const add = (member: Member | null, role: Role | undefined, instrumentId?: string, isLeader = false) => {
    if (!member) return;
    if (!role) throw new Error(`Could not resolve a persisted role for ${member.full_name}.`);
    resolved.push({ memberId: member.id, roleId: role.id, instrumentId, isLeader });
  };
  add(generated.leader, roleFor(generated.leader, (role) => isWorshipLeaderRoleName(role.name)), undefined, true);
  for (const member of generated.backup_singers) add(member, roleFor(member, (role) => isBackupRoleName(role.name)));
  for (const item of generated.instrumentalists) add(item.member, instrumentRoleFor(item.member, item.instrument), item.instrument.id);
  add(generated.devotion, roleFor(generated.devotion, (role) => isDevotionRoleName(role.name)));
  return resolved;
}

function assignmentRowsFor(service: Service, resolved: ResolvedAssignment[], userId: string, now: string): Array<Record<string, unknown>> {
  return resolved.map((row) => ({ service_id: service.id, member_id: row.memberId, role_id: row.roleId, instrument_id: row.instrumentId, is_leader: row.isLeader, status: 'pending', assigned_by: userId, created_at: now, updated_at: now }));
}

export function assignmentRows(service: Service, generated: GeneratedService, userId: string) {
  return assignmentRowsFor(service, resolveAssignments(generated), userId, new Date().toISOString());
}
