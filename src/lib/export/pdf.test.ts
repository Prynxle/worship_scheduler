import { describe, expect, it } from 'vitest';
import { CELL_COLORS, generateSchedulePDF, instrumentRows, type ScheduleForExport } from '@/lib/export/pdf';

type ExportService = ScheduleForExport['services'][number];

/**
 * A service in the shape the export route actually feeds the generator.
 *
 * This matters: the generator reads `instrumentalists` / `backup_singers` /
 * `leader_name`, which only exist after `transformServiceAssignments`. A
 * fixture of raw `Service` rows (with `assignments`) exercises none of that, so
 * the row-label logic has to be tested through this shape or not at all.
 */
function transformed(
  id: string,
  day: number,
  week: number,
  opts: { leader?: string; backups?: string[]; devotion?: string; instrumentalists?: { instrument: string; name: string }[] } = {},
): ExportService {
  return {
    id,
    church_id: 'church-1',
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
  } as unknown as ExportService;
}

function render(data: ScheduleForExport): string {
  const doc = generateSchedulePDF(data);
  return Buffer.from(doc.output('arraybuffer') as ArrayBuffer).toString('latin1');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Every background fill the content stream requests, as 0-1 RGB triples.
 *
 * Both operators matter: jsPDF emits distinct components through `rg`, but an
 * equal-component fill -- the grey `#E1E1E1` body cells -- comes out as the
 * single-component grayscale `g` instead.
 */
function pdfFillColors(pdf: string): number[][] {
  const fills = (pdf.match(/[0-9.]+ [0-9.]+ [0-9.]+ rg/g) ?? []).map((operator) => operator.split(' rg')[0].split(' ').map(Number));
  for (const operator of pdf.match(/[0-9.]+ g/g) ?? []) {
    const gray = Number(operator.split(' g')[0]);
    fills.push([gray, gray, gray]);
  }
  return fills;
}

/** True when some cell in the PDF is shaded with the given color, to within 1/255. */
function pdfShades(pdf: string, color: { r: number; g: number; b: number }): boolean {
  const target = [color.r, color.g, color.b].map((value) => value / 255);
  return pdfFillColors(pdf).some((fill) => fill.every((value, index) => Math.abs(value - target[index]) < 0.01));
}

const LONG_NAME = 'Severino Alexander Maximilliano Constantinople Villaflor';

describe('instrumentRows', () => {
  it('folds real instrument names into the fixed rows instead of duplicating one', () => {
    const services = [
      transformed('s1', 4, 1, {
        instrumentalists: [
          { instrument: 'Guitar', name: 'Mat Banawa' },
          { instrument: 'Piano', name: 'Zedrick Espiritu' },
          { instrument: 'Keyboard', name: 'Kass Reyes' },
          { instrument: 'Drums', name: 'Leander Simone' },
          { instrument: 'Bass', name: 'Caleb Obniala' },
        ],
      }),
    ];

    // `Guitar` must fold into `Guitar/s` rather than being appended as a second
    // guitar row, and `Piano`/`Keyboard` must fold into `Keys`.
    expect(instrumentRows(services).map((row) => row.label)).toEqual(['Guitar/s', 'Keys', 'Drums', 'Bass']);
  });

  it('appends one row per genuinely unmapped instrument, without repeats', () => {
    const services = [
      transformed('s1', 4, 1, { instrumentalists: [{ instrument: 'Violin', name: 'Pia Santos' }] }),
      transformed('s2', 11, 2, {
        instrumentalists: [
          { instrument: 'Violin', name: 'Pia Santos' },
          { instrument: 'Cello', name: 'Beng Matubang' },
        ],
      }),
    ];

    expect(instrumentRows(services).map((row) => row.label)).toEqual(['Guitar/s', 'Keys', 'Drums', 'Bass', 'Violin', 'Cello']);
  });

  it('lets exactly one row claim a mapped instrument', () => {
    const rows = instrumentRows([transformed('s1', 4, 1, { instrumentalists: [{ instrument: 'Guitar', name: 'Mat Banawa' }] })]);
    const claimants = rows.filter((row) => row.matches('Guitar'));

    expect(claimants).toHaveLength(1);
    expect(claimants[0].label).toBe('Guitar/s');
    // Matching is case- and whitespace-insensitive, so a stray ' guitar ' cannot
    // slip past the row that owns it.
    expect(rows.filter((row) => row.matches('  guitar '))).toHaveLength(1);
  });
});

describe('generateSchedulePDF', () => {
  it('renders the selected 0-based month, not the previous one', () => {
    const pdf = render({
      month: 9,
      year: 2026,
      churchName: 'JOHIA Bankers',
      services: [transformed('s1', 4, 1, { leader: 'Dhon Obniala' })],
    });

    expect(pdf).toContain('October 2026');
    expect(pdf).not.toContain('September 2026');
  });

  it('draws the singers as the same date-by-role matrix as the instrumentalists', () => {
    const doc = generateSchedulePDF({
      month: 9,
      year: 2026,
      churchName: 'JOHIA Bankers',
      services: [
        transformed('s1', 4, 1, {
          leader: 'Dhon Obniala',
          backups: ['Heidi Herrera', 'Beng Matubang'],
          devotion: 'Pia Santos',
          instrumentalists: [
            { instrument: 'Guitar', name: 'Mat Banawa' },
            { instrument: 'Drums', name: 'Leander Simone' },
          ],
        }),
      ],
    });
    const pdf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer).toString('latin1');

    expect(pdf).toContain('Worship Leader');
    expect(pdf).toContain('Back-Up');
    expect(pdf).toContain('Devotion');
    expect(pdf).toContain('Dhon Obniala');
    expect(pdf).toContain('Heidi Herrera');
    expect(pdf).toContain('Pia Santos');

    // Exactly one guitar row label is drawn. A duplicate row would make this 2.
    expect(pdf).toContain('Guitar/s');
    expect(countOccurrences(pdf, 'Guitar')).toBe(1);
    expect(pdf).toContain('Drums');
  });

  it('does not crash and notes the empty period when there are no services', () => {
    const pdf = render({ month: 9, year: 2026, churchName: 'JOHIA Bankers', services: [] });
    expect(pdf).toContain('No published or validated schedule found for the selected period.');
  });
});

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
    // Well beyond a real month, on purpose: both matrices now hold only a
    // handful of rows, so the wrapped-name rows have to be stacked deep enough
    // to cross a page boundary before the difference is observable.
    const SERVICES = 20;
    const short = Array.from({ length: SERVICES }, (_, index) =>
      transformed(`short-${index}`, index + 1, index + 1, { leader: 'Feng Lim', backups: ['Beng Matubang'], devotion: 'Lom Del Luna' }),
    );
    const long = Array.from({ length: SERVICES }, (_, index) =>
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
    const pdf = render({
      month: 9,
      year: 2026,
      churchName: 'JOHIA Bankers',
      services: [transformed('s1', 4, 1, { instrumentalists: [{ instrument: 'Violin', name: 'Pia Santos' }] })],
    });

    expect(pdf).toContain('Violin');
    expect(pdf).toContain('Pia Santos');
  });
});

describe('generateSchedulePDF cell colors', () => {
  it('shades the label column, the day numbers, and every name cell in both tables', () => {
    const pdf = render({
      month: 9,
      year: 2026,
      churchName: 'JOHIA Bankers',
      services: [
        transformed('s1', 4, 1, {
          leader: 'Dhon Obniala',
          backups: ['Heidi Herrera'],
          devotion: 'Pia Santos',
          instrumentalists: [{ instrument: 'Guitar', name: 'Mat Banawa' }],
        }),
        transformed('s2', 11, 2, { instrumentalists: [{ instrument: 'Violin', name: 'Pia Santos' }] }),
      ],
    });

    // All three fills appear, and they come from the shared renderer, so the
    // singers matrix and the instrumentalists matrix are shaded identically.
    expect(pdfShades(pdf, CELL_COLORS.label)).toBe(true);
    expect(pdfShades(pdf, CELL_COLORS.date)).toBe(true);
    expect(pdfShades(pdf, CELL_COLORS.body)).toBe(true);
  });

  it('leaves the empty period unshaded, because it draws no table', () => {
    const pdf = render({ month: 9, year: 2026, churchName: 'JOHIA Bankers', services: [] });

    expect(pdfShades(pdf, CELL_COLORS.label)).toBe(false);
    expect(pdfShades(pdf, CELL_COLORS.date)).toBe(false);
    expect(pdfShades(pdf, CELL_COLORS.body)).toBe(false);
  });
});
