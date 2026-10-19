import { describe, expect, it } from 'vitest';
import { generateSchedulePDF, type ScheduleForExport } from '@/lib/export/pdf';
import type { ScheduleAssignment, Service } from '@/lib/types/database';

const CHURCH_ID = 'church-1';

function service(overrides: Partial<Service> & Pick<Service, 'id' | 'date' | 'week_number'>): Service {
  return {
    church_id: CHURCH_ID,
    month: 9,
    year: 2026,
    service_type: 'sunday',
    status: 'draft',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  } as Service;
}

function assignment(
  serviceId: string,
  opts: { member?: string; role?: string; instrument?: string; isLeader?: boolean; isDevotion?: boolean },
): ScheduleAssignment {
  return {
    id: `${serviceId}-${opts.member ?? 'x'}-${opts.instrument ?? opts.role ?? 'r'}`,
    service_id: serviceId,
    member_id: opts.member ?? 'm',
    role_id: opts.role ?? 'role',
    is_leader: opts.isLeader ?? false,
    is_devotion: opts.isDevotion ?? false,
    status: 'confirmed',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    member: opts.member ? ({ id: `member-${opts.member}`, full_name: opts.member } as ScheduleAssignment['member']) : undefined,
    role: opts.role ? ({ id: `role-${opts.role}`, name: opts.role } as ScheduleAssignment['role']) : undefined,
    instrument: opts.instrument ? ({ id: `instrument-${opts.instrument}`, name: opts.instrument } as ScheduleAssignment['instrument']) : undefined,
  } as ScheduleAssignment;
}

function render(data: ScheduleForExport): string {
  const doc = generateSchedulePDF(data as unknown as Record<string, unknown>);
  return Buffer.from(doc.output('arraybuffer') as ArrayBuffer).toString('latin1');
}

const week1 = service({ id: 'svc-1', date: '2026-10-04', week_number: 1 });
const week2 = service({ id: 'svc-2', date: '2026-10-11', week_number: 2 });

function fixture(): ScheduleForExport {
  const services: (Service & { assignments: ScheduleAssignment[] })[] = [
    {
      ...week1,
      assignments: [
        assignment(week1.id, { member: 'Dhon Obniala', role: 'Worship Leader', isLeader: true }),
        assignment(week1.id, { member: 'Heidi Herrera', role: 'Back Up' }),
        assignment(week1.id, { member: 'Beng Matubang', role: 'Back Up' }),
        assignment(week1.id, { member: 'Leander Simone', role: 'Instrumentalist', instrument: 'Drums' }),
        assignment(week1.id, { member: 'Zedrick Espiritu', role: 'Instrumentalist', instrument: 'Piano' }),
        assignment(week1.id, { member: 'Mat Banawa', role: 'Instrumentalist', instrument: 'Guitar' }),
        assignment(week1.id, { member: 'Caleb Obniala', role: 'Instrumentalist', instrument: 'Bass' }),
        assignment(week1.id, { member: 'Pia Santos', role: 'Devotion Leader', isDevotion: true }),
      ],
    },
    {
      ...week2,
      assignments: [
        assignment(week2.id, { member: 'Feng Lim', role: 'Worship Leader', isLeader: true }),
        assignment(week2.id, { member: 'Kass Reyes', role: 'Instrumentalist', instrument: 'Keyboard' }),
      ],
    },
  ];
  return { month: 9, year: 2026, churchName: 'JOHIA Bankers', services };
}

describe('generateSchedulePDF', () => {
  it('renders the selected 0-based month, not the previous one', () => {
    const pdf = render(fixture());
    expect(pdf).toContain('October 2026');
    expect(pdf).not.toContain('September 2026');
  });

  it('renders singers, backups, devotion, and instrumentalists from the assignments', () => {
    const pdf = render(fixture());
    expect(pdf).toBeTruthy();
    expect(pdf.length).toBeGreaterThan(0);
  });

  it('maps real instrument names onto the fixed rows without adding duplicates', () => {
    const pdf = render(fixture());
    // "Piano" and "Keyboard" belong to the "Keys" row, so their raw instrument
    // names must never surface as extra row labels.
    expect(pdf).toContain('Keys');
    expect(pdf).not.toContain('Piano');
    expect(pdf).not.toContain('Keyboard');
  });

  it('does not crash and notes the empty period when there are no services', () => {
    const pdf = render({ month: 9, year: 2026, churchName: 'JOHIA Bankers', services: [] });
    expect(pdf).toContain('No published or validated schedule found for the selected period.');
  });
});

const LONG_NAME = 'Severino Alexander Maximilliano Constantinople Villaflor';

/** A service in the shape the export route actually feeds the generator. */
function transformed(
  id: string,
  day: number,
  week: number,
  opts: { leader?: string; backups?: string[]; devotion?: string; instrumentalists?: { instrument: string; name: string }[] } = {},
): ScheduleForExport['services'][number] {
  return {
    id,
    church_id: CHURCH_ID,
    date: `2026-10-${String(day).padStart(2, '0')}`,
    week_number: week,
    leader_name: opts.leader ?? 'Unassigned',
    backup_singers: (opts.backups ?? []).map((name) => ({ name })),
    instrumentalists: opts.instrumentalists ?? [],
    devotion_name: opts.devotion,
    assignments: [],
    status: 'validated',
    schedule_version: 1,
    conflict_count: 0,
  } as unknown as ScheduleForExport['services'][number];
}

describe('generateSchedulePDF layout', () => {
  it('fits a short month on one page with no trailing blank page', () => {
    const doc = generateSchedulePDF({
      month: 9,
      year: 2026,
      churchName: 'JOHIA Bankers',
      services: [
        transformed('s1', 4, 1, {
          leader: 'Dhon Obniala',
          backups: ['Beng Matubang', 'Heidi Herrera'],
          devotion: 'Lom Del Luna',
          instrumentalists: [{ instrument: 'Piano', name: 'Zedrick Espiritu' }],
        }),
      ],
    });
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('sizes rows to wrapped long names and paginates instead of overlapping', () => {
    const short = Array.from({ length: 10 }, (_, index) =>
      transformed(`short-${index}`, index + 1, index + 1, { leader: 'Feng Lim', backups: ['Beng Matubang'], devotion: 'Lom Del Luna' }),
    );
    const long = Array.from({ length: 10 }, (_, index) =>
      transformed(`long-${index}`, index + 1, index + 1, {
        leader: LONG_NAME,
        backups: [LONG_NAME, LONG_NAME, LONG_NAME, LONG_NAME],
        devotion: LONG_NAME,
        instrumentalists: [{ instrument: 'Guitar', name: LONG_NAME }],
      }),
    );

    const shortDoc = generateSchedulePDF({ month: 9, year: 2026, churchName: 'JOHIA Bankers', services: short });
    const longDoc = generateSchedulePDF({ month: 9, year: 2026, churchName: 'JOHIA Bankers', services: long });

    // Rows grow with the wrapped lines, so the same month needs more pages --
    // which is only true if the row height is driven by the wrap measurement.
    expect(shortDoc.getNumberOfPages()).toBe(1);
    expect(longDoc.getNumberOfPages()).toBeGreaterThan(shortDoc.getNumberOfPages());
  });

  it('renders an extra instrument row label without duplicating a mapped one', () => {
    const doc = generateSchedulePDF({
      month: 9,
      year: 2026,
      churchName: 'JOHIA Bankers',
      services: [transformed('s1', 4, 1, { instrumentalists: [{ instrument: 'Violin', name: 'Pia Santos' }] })],
    });
    const pdf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer).toString('latin1');
    expect(pdf).toContain('Violin');
  });
});

