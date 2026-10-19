import jsPDF from 'jspdf';
import { TransformedService } from '@/lib/scheduling/service-transform';

export interface ScheduleForExport {
  /** 0-based month, matching `services.month` and `GET /api/schedule`. */
  month: number;
  year: number;
  churchName: string;
  churchLogoUrl?: string;
  services: (TransformedService & { assignments: Array<Record<string, unknown>> })[];
}

/** Body text size and the vertical rhythm used to size rows to their content. */
const CELL_FONT_SIZE = 8;
const CELL_LINE_HEIGHT = 3.5;
const CELL_PADDING = 2.5;

/**
 * Cell background colors, shared by both matrices because they are drawn by
 * one renderer. jsPDF fills in RGB only, so the values live here as components
 * rather than as hex strings.
 */
export const CELL_COLORS = {
  /** The whole row-label column, including each table's `Date` header cell. */
  label: { r: 197, g: 213, b: 241 }, // #C5D5F1
  /** The day numbers across the header row. */
  date: { r: 250, g: 225, b: 153 }, // #FAE199
  /** Member-name cells. Empty ones are shaded too, so the table reads as one grid. */
  body: { r: 225, g: 225, b: 225 }, // #E1E1E1
} as const;

function formatMemberNames(names: string[]): string {
  return names.filter(Boolean).join(', ');
}

function normalizeInstrument(instrument: string): string {
  return instrument.trim().toLowerCase();
}

/**
 * Split a cell's text into the lines it will actually occupy.
 *
 * Sizing rows from this measurement is what stops a long name from wrapping
 * into the row below: jsPDF's `maxWidth` wraps text but never grows the row, so
 * the wrap and the row height have to be driven from one place.
 */
function cellLines(doc: jsPDF, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const lines = doc.splitTextToSize(text, Math.max(maxWidth, 1)) as unknown;
  if (Array.isArray(lines)) return lines as string[];
  return [String(lines)];
}

/** The height a row needs so that its tallest cell is fully visible. */
function rowHeightFor(lineCounts: number[]): number {
  return Math.max(1, ...lineCounts) * CELL_LINE_HEIGHT + CELL_PADDING;
}

function drawCell(doc: jsPDF, lines: string[], x: number, y: number): void {
  lines.forEach((line, index) => {
    doc.text(line, x, y + CELL_LINE_HEIGHT * (index + 1) - 1);
  });
}

/**
 * Fills a cell's background and strokes its border. Fill first so the border
 * is drawn on top of the shading and stays visible at every page position.
 */
function fillCell(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): void {
  doc.setFillColor(color.r, color.g, color.b);
  doc.rect(x, y, width, height, 'F');
  doc.rect(x, y, width, height);
}

/** An instrument table row: its label, and the matcher that owns it. */
export interface InstrumentRow {
  label: string;
  /** True when this row owns the instrument. Case- and whitespace-insensitive. */
  matches: (instrument: string) => boolean;
}

/**
 * The four rows every sheet carries, each paired with the matcher that claims
 * its instruments.
 *
 * The label and its matcher MUST stay in one place. They used to live apart:
 * the fixed labels seeded a "seen" set of raw names while the cells matched by
 * category, so the live `Guitar` instrument missed the `Guitar/s` label and was
 * appended as a second Guitar row listing the same guitarists -- `Piano` did
 * the same thing to `Keys`. One matcher can neither shadow nor duplicate its
 * own row.
 */
const FIXED_INSTRUMENT_ROWS: ReadonlyArray<{
  label: string;
  matches: (instrument: string) => boolean;
}> = [
  { label: 'Guitar/s', matches: (instrument) => normalizeInstrument(instrument).includes('guitar') },
  { label: 'Keys', matches: (instrument) => /key|piano|organ/.test(normalizeInstrument(instrument)) },
  { label: 'Drums', matches: (instrument) => /drum|percussion/.test(normalizeInstrument(instrument)) },
  { label: 'Bass', matches: (instrument) => normalizeInstrument(instrument).includes('bass') },
];

/**
 * The instrument table's rows: the four fixed rows every sheet carries, plus
 * one row per instrument that matches none of them (e.g. `Violin`), in
 * first-seen order. Repeated spellings collapse onto the first one seen, so an
 * instrument can never be claimed by two rows.
 */
export function instrumentRows(services: ScheduleForExport['services']): InstrumentRow[] {
  const rows: InstrumentRow[] = FIXED_INSTRUMENT_ROWS.map((row) => ({ ...row }));
  const extras = new Map<string, string>();

  for (const service of services) {
    for (const player of service.instrumentalists || []) {
      const raw = (player.instrument || '').trim();
      const instrument = normalizeInstrument(raw);
      if (!instrument) continue;
      if (FIXED_INSTRUMENT_ROWS.some((row) => row.matches(instrument))) continue;
      if (!extras.has(instrument)) extras.set(instrument, raw);
    }
  }

  for (const [instrument, label] of extras) {
    rows.push({
      label,
      matches: (candidate) => {
        const normalized = normalizeInstrument(candidate);
        return normalized === instrument || normalized.includes(instrument);
      },
    });
  }

  return rows;
}

/** A rendered matrix row: a label plus the text one service contributes. */
interface MatrixRow {
  label: string;
  value: (service: ScheduleForExport['services'][number]) => string;
}

/**
 * Draws one bordered date-by-role matrix: a `Date` header cell followed by one
 * column per service, then one row per supplied label. Every cell is sized from
 * the line count it will occupy, and a row that does not fit starts a new page
 * rather than overlapping the next one.
 *
 * Both the singers and the instrumentalists sections share this renderer, so
 * they can differ only in their rows and heading -- never in geometry or
 * shading: the label column, the day numbers, and the name cells take the same
 * `CELL_COLORS` in either table.
 *
 * Returns the y cursor below the table.
 */
function drawMatrixTable(
  doc: jsPDF,
  options: {
    title: string;
    services: ScheduleForExport['services'];
    rows: MatrixRow[];
    /** Where the heading is drawn; may be pushed to a new page. */
    startY: number;
    margin: number;
  },
): number {
  const { title, services, rows, margin } = options;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  let y = options.startY;

  // A heading that fits but cannot be followed by even one row would strand it
  // alone at the bottom of the page, so break first when that is what fits.
  if (y + rowHeightFor([1]) + 20 > pageHeight - margin) {
    doc.addPage();
    y = margin + 10;
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(title, margin, y);
  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  const colWidth = contentWidth / (services.length + 1);
  const cellWidth = Math.max(colWidth - 3, 6);
  const headerRowHeight = CELL_LINE_HEIGHT + CELL_PADDING;

  doc.setFontSize(CELL_FONT_SIZE);
  doc.setFont('helvetica', 'bold');
  fillCell(doc, margin, y, colWidth, headerRowHeight, CELL_COLORS.label);
  doc.text('Date', margin + 1.5, y + CELL_LINE_HEIGHT + 0.5);
  services.forEach((service, index) => {
    const x = margin + colWidth * (index + 1);
    fillCell(doc, x, y, colWidth, headerRowHeight, CELL_COLORS.date);
    const day = new Date(service.date).getUTCDate().toString();
    doc.text(day, x + colWidth / 2, y + CELL_LINE_HEIGHT + 0.5, { align: 'center' });
  });
  y += headerRowHeight;
  doc.setFont('helvetica', 'normal');

  for (const row of rows) {
    const labelLines = cellLines(doc, row.label, cellWidth);
    const cellCells = services.map((service) => cellLines(doc, row.value(service), cellWidth));
    const rowHeight = rowHeightFor([labelLines.length, ...cellCells.map((cell) => cell.length)]);

    if (y + rowHeight > pageHeight - margin) {
      doc.addPage();
      y = margin + 10;
    }

    doc.setFontSize(CELL_FONT_SIZE);
    doc.setFont('helvetica', 'normal');
    fillCell(doc, margin, y, colWidth, rowHeight, CELL_COLORS.label);
    drawCell(doc, labelLines, margin + 1.5, y);
    cellCells.forEach((lines, index) => {
      const x = margin + colWidth * (index + 1);
      // Shaded whether or not a name is in it: a white gap in an otherwise
      // grey column reads as a missing cell rather than an empty one.
      fillCell(doc, x, y, colWidth, rowHeight, CELL_COLORS.body);
      drawCell(doc, lines, x + 1.5, y);
    });
    y += rowHeight;
  }

  return y;
}

export function generateSchedulePDF(data: ScheduleForExport): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 12;

  const monthYear = new Date(data.year, data.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  let y = margin + 12;
  const logoSize = 16;
  const logoY = margin + 2;

  if (data.churchLogoUrl) {
    try {
      doc.addImage(data.churchLogoUrl, 'PNG', margin, logoY, logoSize, logoSize);
    } catch {
      // ignore logo if it fails
    }
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(data.churchName || 'Worship Schedule', margin + logoSize + 4, logoY + logoSize / 2 + 2);
  y = Math.max(logoY + logoSize + 6, margin + 20);

  const sortedServices = [...data.services].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (sortedServices.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('No published or validated schedule found for the selected period.', margin, y + 6);
    return doc;
  }

  // Singers first, as the same date-by-role matrix the instrumentalists use.
  const singerRows: MatrixRow[] = [
    { label: 'Worship Leader', value: (service) => (service.leader_name !== 'Unassigned' ? service.leader_name : '') },
    {
      label: 'Back-Up',
      value: (service) =>
        formatMemberNames((service.backup_singers || []).map((backup) => backup.name).filter((name) => name !== 'Unassigned')),
    },
    { label: 'Devotion', value: (service) => service.devotion_name || '' },
  ];

  y = drawMatrixTable(doc, {
    title: `${monthYear} Worship Team Singers`,
    services: sortedServices,
    rows: singerRows,
    startY: y,
    margin,
  });

  // One row per instrument, each cell drawn from the row's own matcher, so the
  // row that shows a player is the only row able to claim them.
  const instrumentTableRows: MatrixRow[] = instrumentRows(sortedServices).map((row) => ({
    label: row.label,
    value: (service) =>
      formatMemberNames(
        (service.instrumentalists || [])
          .filter((player) => row.matches(player.instrument || ''))
          .map((player) => player.name)
          .filter((name) => name !== 'Unassigned'),
      ),
  }));

  drawMatrixTable(doc, {
    title: `${monthYear} Worship Team Instrumentalists`,
    services: sortedServices,
    rows: instrumentTableRows,
    startY: y + 10,
    margin,
  });

  return doc;
}
