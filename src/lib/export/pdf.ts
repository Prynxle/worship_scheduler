import jsPDF from 'jspdf';
import { isBackupRoleName } from '@/lib/scheduling/role-classifier';
import { ScheduleAssignment, Service } from '@/lib/types/database';

export interface ScheduleForExport {
  /** 0-based month, matching `services.month` and `GET /api/schedule`. */
  month: number;
  year: number;
  churchName: string;
  churchLogoUrl?: string;
  services: (Service & { assignments: ScheduleAssignment[] })[];
}

interface InstrumentRow {
  label: string;
  /** `instrumentName` is already trimmed and lower-cased. */
  matches: (instrumentName: string) => boolean;
}

const BASE_INSTRUMENT_ROWS: InstrumentRow[] = [
  { label: 'Guitar/s', matches: (name) => name.includes('guitar') },
  { label: 'Keys', matches: (name) => /key|piano|organ/.test(name) },
  { label: 'Drums', matches: (name) => /drum|percussion/.test(name) },
  { label: 'Bass', matches: (name) => name.includes('bass') },
];

function memberName(assignment: ScheduleAssignment): string {
  return assignment.member?.full_name || '';
}

/**
 * The instrument rows shown in the instrumentalist grid. The four common rows
 * are always present, in the reference order; any instrument in the data that
 * none of them matches (e.g. a configured "Violin") becomes its own row instead
 * of being silently dropped. This is also why a "Piano"/"Keyboard" instrument
 * no longer adds a duplicate row next to "Keys".
 */
function buildInstrumentRows(services: ScheduleForExport['services']): InstrumentRow[] {
  const present = new Set<string>();
  for (const service of services) {
    for (const assignment of service.assignments || []) {
      const name = (assignment.instrument?.name || '').trim().toLowerCase();
      if (name) present.add(name);
    }
  }
  const extraRows: InstrumentRow[] = Array.from(present)
    .filter((name) => !BASE_INSTRUMENT_ROWS.some((row) => row.matches(name)))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ label: name, matches: (candidate: string) => candidate === name || candidate.includes(name) }));
  return [...BASE_INSTRUMENT_ROWS, ...extraRows];
}

export function generateSchedulePDF(data: ScheduleForExport): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;

  // `data.month` is 0-based, so `new Date(year, month)` is the correct month.
  // Subtracting 1 (the old code) rendered the month before the selected one.
  const monthYear = new Date(data.year, data.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(data.churchName || 'Worship Schedule', margin, margin + 8);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(monthYear + ' Worship Team Singers', margin, margin + 16);

  doc.setDrawColor(0, 0, 0);
  doc.line(margin, margin + 18, pageWidth - margin, margin + 18);

  const sortedServices = [...data.services].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let y = margin + 25;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Date', margin, y);
  doc.text('Worship Leader', margin + 20, y);
  doc.text('Back-Up', margin + 60, y);
  doc.text('Devotion', margin + 120, y);
  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');

  for (const service of sortedServices) {
    const assignments = service.assignments || [];
    const leaderAssignment = assignments.find((assignment) => assignment.is_leader)
      || assignments.find((assignment) => (assignment.role?.name || '').toLowerCase().includes('leader'));
    const devotionAssignment = assignments.find((assignment) => assignment.is_devotion);
    const backupNames = assignments
      .filter((assignment) => !assignment.is_leader && !assignment.is_devotion && assignment.role && isBackupRoleName(assignment.role.name))
      .map(memberName)
      .filter(Boolean);
    const dateNum = new Date(service.date).getUTCDate().toString();

    doc.setFontSize(8);
    doc.text(dateNum, margin, y);
    doc.text(leaderAssignment ? memberName(leaderAssignment) : '', margin + 20, y, { maxWidth: 35 });
    doc.text(backupNames.join(', '), margin + 60, y, { maxWidth: 55 });
    doc.text(devotionAssignment ? memberName(devotionAssignment) : '', margin + 120, y, { maxWidth: 45 });
    y += 6;
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;

    if (y > pageHeight - 40) {
      doc.addPage();
      y = margin + 10;
    }
  }

  if (sortedServices.length === 0) {
    y += 6;
    doc.setFontSize(10);
    doc.text('No services found for the selected period.', margin, y);
    return doc;
  }

  if (y < pageHeight - 70) {
    y += 10;
  } else {
    doc.addPage();
    y = margin + 10;
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
  const instrumentRows = buildInstrumentRows(sortedServices);

  const colWidth = (pageWidth - margin * 2) / (dates.length + 1);
  const rowHeight = 6;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('Date', margin + 1.5, y + 4);
  doc.rect(margin, y, colWidth, rowHeight);
  dates.forEach((entry, index) => {
    const x = margin + colWidth * (index + 1);
    doc.text(entry.date.toString(), x + colWidth / 2, y + 4, { align: 'center' });
    doc.rect(x, y, colWidth, rowHeight);
  });
  y += rowHeight;
  doc.setFont('helvetica', 'normal');

  instrumentRows.forEach((row) => {
    if (y + rowHeight > pageHeight - margin) {
      doc.addPage();
      y = margin + 10;
    }
    doc.text(row.label, margin + 1.5, y + 4, { maxWidth: colWidth - 3 });
    doc.rect(margin, y, colWidth, rowHeight);
    dates.forEach((entry, index) => {
      const x = margin + colWidth * (index + 1);
      const names = (entry.service.assignments || [])
        .filter((assignment) => {
          const instrumentName = (assignment.instrument?.name || '').trim().toLowerCase();
          return Boolean(instrumentName) && row.matches(instrumentName);
        })
        .map(memberName)
        .filter(Boolean)
        .join(', ');
      doc.text(names, x + 1.5, y + 4, { maxWidth: colWidth - 3 });
      doc.rect(x, y, colWidth, rowHeight);
    });
    y += rowHeight;
  });

  return doc;
}
