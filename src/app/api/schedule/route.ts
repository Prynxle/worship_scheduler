import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { SchedulingEngine } from '@/lib/scheduling/engine';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { formatLocalDate, getWeeksInMonth, getWeekDate } from '@/lib/utils/date-utils';
import { ScheduleContext, SchedulingFailureError, GeneratedService } from '@/lib/types/scheduling';
import { Member, Role, ScheduleAssignment, Service } from '@/lib/types/database';
import { loadAvailabilityReadiness } from '@/lib/scheduling/availability-readiness';

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
  return {
    id: service.id,
    church_id: service.church_id,
    ministry_id: service.ministry_id ?? null,
    legacy_unscoped: !service.ministry_id,
    date: service.date,
    week_number: service.week_number,
    leader_name: leader?.full_name ?? 'Unassigned',
    leader_avatar: leader?.avatar_url,
    backup_singers: own.filter((assignment) => !assignment.is_leader && (assignment.role?.name.toLowerCase().includes('vocal') || assignment.role?.name.toLowerCase().includes('singer'))).map((assignment) => ({ name: assignment.member?.full_name ?? 'Unassigned', avatar: assignment.member?.avatar_url })),
    instrumentalists: own.filter((assignment) => assignment.instrument).map((assignment) => ({ instrument: assignment.instrument?.name ?? 'Instrument', name: assignment.member?.full_name ?? 'Unassigned' })),
    devotion_name: own.find((assignment) => assignment.role?.name.toLowerCase().includes('devotion'))?.member?.full_name,
    assignments: own.map((assignment) => ({ id: assignment.id, member_id: assignment.member_id, member_name: assignment.member?.full_name ?? 'Unknown member', role_id: assignment.role_id, role_name: assignment.role?.name ?? 'Unknown role', instrument_id: assignment.instrument_id ?? null, instrument_name: assignment.instrument?.name ?? null, is_leader: assignment.is_leader })),
    status: service.status,
    schedule_version: service.schedule_version ?? 1,
    validated_version: service.validated_version ?? null,
    validated_by: service.validated_by ?? null,
    validated_at: service.validated_at ?? null,
    generated_at: service.generated_at ?? null,
    published_at: service.published_at ?? null,
    published_by: service.published_by ?? null,
    revision_of: service.revision_of ?? null,
    conflict_count: 0,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  let selection: { month: number; year: number };
  try {
    selection = parseMonthYear(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'A valid month and year are required.' }, { status: 400 });
  }
  const { month, year } = selection;
  try {
    const ministryId = new URL(request.url).searchParams.get('ministry_id') ?? undefined;
    const readiness = await loadAvailabilityReadiness(auth.churchId, month, year, ministryId);
    const data = await loadScheduleData(auth.churchId, month, year, readiness.ministry_id);
    return NextResponse.json({
      services: data.services.map((service) => serviceAssignments(service, data.assignments)),
      members: data.members.filter((member) => member.status === 'active').map((member) => ({ id: member.id, full_name: member.full_name, roles: member.roles?.map((item) => item.role).filter(Boolean), skills: member.skills?.map((item) => item.instrument).filter(Boolean) })),
      roles: data.roles,
      instruments: data.instruments,
      month,
      year,
      ministry_id: readiness.ministry_id,
      ministry_name: readiness.ministry_name,
      church_id: auth.churchId,
    });
  } catch (error) {
    console.error('GET /api/schedule failed', error);
    const message = error instanceof Error ? error.message : 'Could not load schedules.';
    const status = message === 'No active ministry was found for this church.' ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? message : 'Could not load schedules.' }, { status });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 });
    const { month, year } = parseMonthYear(request, body);
    if (body.regenerate !== undefined && typeof body.regenerate !== 'boolean') return NextResponse.json({ error: 'regenerate must be a boolean.' }, { status: 400 });
    const today = new Date();
    const todayString = formatLocalDate(today);
    if (year < today.getFullYear() || (year === today.getFullYear() && month < today.getMonth())) {
      return NextResponse.json({ error: 'Schedules can only be generated for the current or a future month.' }, { status: 400 });
    }
    const readiness = await loadAvailabilityReadiness(auth.churchId, month, year, typeof body.ministry_id === 'string' ? body.ministry_id : undefined);
    if (!readiness.ready) return NextResponse.json({ error: 'Monthly availability is not approved for every required member.', readiness }, { status: 409 });
    const count = getWeeksInMonth(month, year);
    const futureWeeks = Array.from({ length: count }, (_, index) => index + 1)
      .filter((week) => formatLocalDate(getWeekDate(week, month, year)) >= todayString);
    const requested = body.week_numbers;
    const weekNumbers = requested === undefined ? futureWeeks : requested;
    if (!Array.isArray(weekNumbers) || weekNumbers.length === 0 || weekNumbers.some((week) => typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > count)) return NextResponse.json({ error: 'week_numbers must contain valid weeks for the requested month.' }, { status: 400 });
    if (new Set(weekNumbers).size !== weekNumbers.length) return NextResponse.json({ error: 'Each service week can only be generated once.' }, { status: 400 });
    if (weekNumbers.some((week) => !futureWeeks.includes(week))) return NextResponse.json({ error: 'Schedules can only be generated for service dates that have not passed.' }, { status: 400 });
    const data = await loadScheduleData(auth.churchId, month, year, readiness.ministry_id);
    const selected = new Set(weekNumbers);
    const protectedServices = data.services.filter((service) => selected.has(service.week_number) && ['published', 'validated'].includes(service.status));
    if (protectedServices.length) return NextResponse.json({ error: 'Published or validated services cannot be regenerated.', service_ids: protectedServices.map((service) => service.id) }, { status: 409 });
    const replaceable = new Set(data.services.filter((service) => selected.has(service.week_number)).map((service) => service.id));
    const historicalAssignments = data.monthlyAssignments.filter((assignment) => !replaceable.has(assignment.service_id));
    const firstWeek = weekNumbers[0];
    const context: ScheduleContext = { service: { id: 'generation', church_id: auth.churchId, date: formatLocalDate(getWeekDate(firstWeek, month, year)), week_number: firstWeek, month, year, service_type: 'sunday', status: 'draft', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, church_id: auth.churchId, month, year, week_number: firstWeek, week_numbers: weekNumbers, existing_assignments: historicalAssignments, historical_assignments: data.monthlyAssignments, available_members: data.members, all_members: data.members, rules: data.rules, config: data.config };
    const generated = await new SchedulingEngine(context).generateSchedule();
    await persistGeneratedSchedule(auth.userId, auth.churchId, readiness.ministry_id, month, year, generated, body.regenerate === true);
    return NextResponse.json({ services: generated, validation: generated.flatMap((service) => service.conflicts), readiness, month, year, ministry_id: readiness.ministry_id }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    if (error instanceof SchedulingFailureError) return NextResponse.json({ services: [], validation: [], failures: error.failures }, { status: 422 });
    const message = error instanceof Error ? error.message : 'Could not generate schedule.';
    return NextResponse.json({ error: message }, { status: /already exists|legacy schedule|Only draft schedules|not ready/i.test(message) ? 409 : 400 });
  }
}

async function persistGeneratedSchedule(userId: string, churchId: string, ministryId: string, month: number, year: number, generated: GeneratedService[], regenerate: boolean) {
  const admin = getAdminClient();
  const { error } = await admin.rpc('persist_month_schedule', {
    p_church_id: churchId,
    p_ministry_id: ministryId,
    p_month: month,
    p_year: year,
    p_actor_id: userId,
    p_services: generated.map((service) => ({
      date: service.date,
      week_number: service.week_number,
      assignments: assignmentRows(service),
    })),
    p_replace_existing: regenerate,
  });
  if (error) throw new Error(error.message);
}

function roleFor(member: Member | null, predicate: (role: Role) => boolean): Role | undefined { return member?.roles?.map((item) => item.role).find((role) => role ? predicate(role) : false); }
function assignmentRows(generated: GeneratedService) {
  const rows: Array<{ member_id: string; role_id: string; instrument_id: string | null; is_leader: boolean }> = [];
  const add = (member: Member | null, role: Role | undefined, instrumentId?: string, isLeader = false) => { if (member && role) rows.push({ member_id: member.id, role_id: role.id, instrument_id: instrumentId ?? null, is_leader: isLeader }); };
  add(generated.leader, roleFor(generated.leader, (role) => role.name.toLowerCase() === 'worship leader'), undefined, true);
  for (const member of generated.backup_singers) add(member, roleFor(member, (role) => /vocal|singer|backup/.test(role.name.toLowerCase())));
  for (const item of generated.instrumentalists) add(item.member, roleFor(item.member, (role) => role.name.toLowerCase().includes(item.instrument.name.toLowerCase()) || /guitar|drum|pian|keyboard/.test(role.name.toLowerCase())), item.instrument.id);
  add(generated.devotion, roleFor(generated.devotion, (role) => role.name.toLowerCase().includes('devotion')));
  return rows;
}
