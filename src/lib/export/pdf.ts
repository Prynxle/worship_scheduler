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

function formatMemberNames(names: string[]): string {
  return names.filter(Boolean).join(', ');
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

export function generateSchedulePDF(data: ScheduleForExport): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;

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
  doc.setFont('helvetica', 'normal');
  doc.text(monthYear + ' Worship Team Singers', margin, y);
  y += 2;
  doc.setDrawColor(0, 0, 0);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;

  const sortedServices = [...data.services].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Fixed singer/instrumentalist sheet columns. Widths are the wrap widths, and
  // the row height is derived from the wrap so a long name can never bleed into
  // the next row or off the page.
  const columns = [
    { x: margin, width: 18, header: 'Date' },
    { x: margin + 20, width: 38, header: 'Worship Leader' },
    { x: margin + 60, width: 56, header: 'Back-Up' },
    { x: margin + 118, width: 46, header: 'Devotion' },
  ];

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  for (const column of columns) doc.text(column.header, column.x, y);
  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');

  for (const service of sortedServices) {
    const leaderName = service.leader_name !== 'Unassigned' ? service.leader_name : '';
    const backupNames = (service.backup_singers || []).map((b) => b.name).filter((n) => n !== 'Unassigned');
    const devotionName = service.devotion_name || '';
    const dateNum = new Date(service.date).getUTCDate().toString();

    doc.setFontSize(CELL_FONT_SIZE);
    const cells = [
      cellLines(doc, dateNum, columns[0].width),
      cellLines(doc, leaderName, columns[1].width),
      cellLines(doc, formatMemberNames(backupNames), columns[2].width),
      cellLines(doc, devotionName, columns[3].width),
    ];
    const rowHeight = rowHeightFor(cells.map((cell) => cell.length));

    if (y + rowHeight > pageHeight - margin) {
      doc.addPage();
      y = margin + 10;
    }

    cells.forEach((lines, index) => drawCell(doc, lines, columns[index].x, y));
    y += rowHeight;
    doc.line(margin, y, pageWidth - margin, y);
    y += 3;
  }

  if (sortedServices.length === 0) {
    y += 6;
    doc.setFontSize(10);
    doc.text('No published or validated schedule found for the selected period.', margin, y);
    return doc;
  }

  // Instrumentalists section: a new page only when the heading could not fit
  // with at least one row beneath it, so a heading never lands alone at the
  // bottom of a page.
  if (y + rowHeightFor([1]) + 20 > pageHeight - margin) {
    doc.addPage();
    y = margin + 10;
  } else {
    y += 10;
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(monthYear + ' Worship Team Instrumentalists', margin, y);
  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  const dates = sortedServices.map((service) => ({
    date: new Date(service.date).getUTCDate(),
    service,
  }));

  const instrumentRowLabels: string[] = [];
  const seen = new Set<string>();
  const baseLabels = ['Guitar/s', 'Keys', 'Drums', 'Bass'];
  for (const label of baseLabels) {
    instrumentRowLabels.push(label);
    seen.add(label.toLowerCase());
  }
  for (const service of sortedServices) {
    for (const player of (service.instrumentalists || [])) {
      const inst = (player.instrument || '').trim().toLowerCase();
      if (inst && !seen.has(inst)) {
        instrumentRowLabels.push(player.instrument);
        seen.add(inst);
      }
    }
  }

  const colWidth = contentWidth / (dates.length + 1);
  const cellWidth = Math.max(colWidth - 3, 6);
  const headerRowHeight = CELL_LINE_HEIGHT + CELL_PADDING;

  doc.setFontSize(CELL_FONT_SIZE);
  doc.setFont('helvetica', 'bold');
  doc.text('Date', margin + 1.5, y + CELL_LINE_HEIGHT + 0.5);
  doc.rect(margin, y, colWidth, headerRowHeight);
  dates.forEach((entry, index) => {
    const x = margin + colWidth * (index + 1);
    doc.text(entry.date.toString(), x + colWidth / 2, y + CELL_LINE_HEIGHT + 0.5, { align: 'center' });
    doc.rect(x, y, colWidth, headerRowHeight);
  });
  y += headerRowHeight;
  doc.setFont('helvetica', 'normal');

  instrumentRowLabels.forEach((rowLabel) => {
    const rowLower = rowLabel.toLowerCase();
    const labelLines = cellLines(doc, rowLabel, cellWidth);
    const cellCells = dates.map((entry) => {
      const names = (entry.service.instrumentalists || [])
        .filter((player) => {
          const inst = (player.instrument || '').toLowerCase();
          if (rowLower === 'guitar/s') return inst.includes('guitar');
          if (rowLower === 'keys') return /key|piano|organ/.test(inst);
          if (rowLower === 'drums') return /drum|percussion/.test(inst);
          if (rowLower === 'bass') return inst.includes('bass');
          return inst === rowLower || inst.includes(rowLower);
        })
        .map((player) => player.name)
        .filter((n) => n !== 'Unassigned')
        .join(', ');
      return cellLines(doc, names, cellWidth);
    });

    const rowHeight = rowHeightFor([labelLines.length, ...cellCells.map((cell) => cell.length)]);
    if (y + rowHeight > pageHeight - margin) {
      doc.addPage();
      y = margin + 10;
    }

    doc.setFontSize(CELL_FONT_SIZE);
    doc.setFont('helvetica', 'normal');
    drawCell(doc, labelLines, margin + 1.5, y);
    doc.rect(margin, y, colWidth, rowHeight);
    cellCells.forEach((lines, index) => {
      const x = margin + colWidth * (index + 1);
      drawCell(doc, lines, x + 1.5, y);
      doc.rect(x, y, colWidth, rowHeight);
    });
    y += rowHeight;
  });

  return doc;
}
