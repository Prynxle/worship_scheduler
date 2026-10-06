import jsPDF from 'jspdf';
import { ScheduleAssignment, Service } from '@/lib/types/database';

export interface ScheduleForExport {
  month: number;
  year: number;
  churchName: string;
  churchLogoUrl?: string;
  services: (Service & { assignments: ScheduleAssignment[] })[];
}

export function generateSchedulePDF(data: ScheduleForExport): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;

  doc.setFontSize(16);
  doc.text(data.churchName || 'Worship Schedule', margin, margin + 8);
  doc.setFontSize(10);
  const monthYear = new Date(data.year, data.month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  doc.text(monthYear, margin, margin + 15);

  let y = margin + 25;

  for (const service of data.services) {
    doc.setFontSize(12);
    const serviceName = service.name || 'Service';
    doc.text(serviceName, margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.text('Date: ' + service.date, margin, y);
    y += 4;
    if (service.time) {
      doc.text('Time: ' + service.time, margin + 60, y - 4);
    }
    y += 4;

    const worshipLeaders = (service.assignments || []).filter(
      (a: ScheduleAssignment) =>
        a.role?.name?.toLowerCase().includes('worship leader') ||
        a.role?.name?.toLowerCase().includes('leader')
    );
    if (worshipLeaders.length > 0) {
      doc.setFontSize(9);
      doc.text('Worship Leader:', margin, y);
      y += 4;
      worshipLeaders.forEach((a: ScheduleAssignment) => {
        const name = a.member?.name || a.member?.email || '';
        if (name) {
          doc.text('- ' + name, margin, y);
          y += 3;
        }
      });
      y += 2;
    }

    y = drawTable(doc, pageWidth, pageHeight, margin, y, service.assignments || []);

    y += 6;
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  return doc;
}

function drawTable(doc: jsPDF, pageWidth: number, pageHeight: number, margin: number, y: number, assignments: ScheduleAssignment[]) {
  doc.setFontSize(9);
  doc.text('Singers', margin, y);
  y += 4;

  const singers = assignments.filter(
    (a: ScheduleAssignment) =>
      a.role?.name?.toLowerCase().includes('singer') ||
      a.role?.name?.toLowerCase().includes('voc') ||
      a.instrument?.name?.toLowerCase().includes('vox')
  );
  const parts = ['Soprano', 'Alto', 'Tenor', 'Bass'];
  parts.forEach((part) => {
    const partAssignments = singers.filter(
      (a: ScheduleAssignment) =>
        a.instrument?.name?.toLowerCase().includes(part.toLowerCase()) ||
        a.role?.name?.toLowerCase().includes(part.toLowerCase())
    );
    const names = partAssignments.map((a: ScheduleAssignment) => a.member?.name || '').filter(Boolean).join(', ');
    if (names || y < pageHeight - margin) {
      doc.text(part + ': ' + (names || '-'), margin + 2, y);
      y += 3;
    }
  });
  y += 3;

  doc.text('Instrumentalists', margin, y);
  y += 4;
  const instrumentalists = assignments.filter(
    (a: ScheduleAssignment) =>
      !(a.role?.name?.toLowerCase().includes('singer') ||
        a.role?.name?.toLowerCase().includes('voc') ||
        a.instrument?.name?.toLowerCase().includes('vox'))
  );
  const instNames = instrumentalists.map((a: ScheduleAssignment) => a.member?.name || '').filter(Boolean);
  if (instNames.length > 0) {
    doc.text(instNames.join(', '), margin + 2, y);
    y += 3;
  } else {
    doc.text('-', margin + 2, y);
    y += 3;
  }

  return y;
}
