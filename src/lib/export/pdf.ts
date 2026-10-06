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

  doc.setFontSize(14);
  doc.text(data.churchName || 'Worship Schedule', margin, margin + 8);
  const monthYear = new Date(data.year, data.month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  doc.setFontSize(12);
  doc.text(monthYear + ' Worship Team Singers', margin, margin + 16);
  
  doc.setDrawColor(0, 0, 0);
  doc.line(margin, margin + 18, pageWidth - margin, margin + 18);

  let y = margin + 24;
  doc.setFontSize(9);
  doc.text('Date', margin, y);
  doc.text('Worship Leader', margin + 20, y);
  doc.text('Back-Up', margin + 60, y);
  doc.text('Devotion', margin + 120, y);
  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  const sortedServices = [...data.services].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (const service of sortedServices) {
    const dateNum = new Date(service.date).getUTCDate();
    const worshipLeaders = (service.assignments || []).filter(
      (a: ScheduleAssignment) =>
        (a.role?.name || '').toLowerCase().includes('worship leader') ||
        (a.role?.name || '').toLowerCase().includes('leader')
    );
    const backups = (service.assignments || []).filter(
      (a: ScheduleAssignment) =>
        (a.role?.name || '').toLowerCase().includes('backup') ||
        (a.role?.name || '').toLowerCase().includes('back-up') ||
        (a.role?.name || '').toLowerCase().includes('back up')
    );
    const otherSingers = (service.assignments || []).filter((a: ScheduleAssignment) => {
      const name = (a.role?.name || '').toLowerCase();
      const isLeader = name.includes('leader');
      const isBackup = name.includes('backup') || name.includes('back-up') || name.includes('back up');
      const isSinger = name.includes('singer') || name.includes('voc') || (a.instrument?.name || '').toLowerCase().includes('vox');
      return isSinger && !isLeader && !isBackup;
    });

    const backupNames = [...backups, ...otherSingers]
      .map((a) => a.member?.full_name || '')
      .filter(Boolean)
      .slice(0, 15);
    const leaderName = worshipLeaders.map((a) => a.member?.full_name || '').filter(Boolean)[0] || '';

    doc.setFontSize(8);
    doc.text(dateNum.toString(), margin, y);
    doc.text(leaderName, margin + 20, y, { maxWidth: 35 });
    doc.text(backupNames.join(', '), margin + 60, y, { maxWidth: 55 });
    doc.text('', margin + 120, y);
    y += 6;
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;

    if (y > pageHeight - 40) {
      doc.addPage();
      y = margin + 10;
    }
  }

  if (y < pageHeight - 70) {
    y = y + 10;
  } else {
    doc.addPage();
    y = margin + 10;
  }

  doc.setFontSize(12);
  doc.text(monthYear + ' Worship Team Instrumentalists', margin, y);
  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // If no data, add note
  if (sortedServices.length === 0) {
    doc.setFontSize(10);
    doc.text('No services found for the selected period.', margin, y + 10);
    return doc;
  }

  // Build instrumentalist table as requested
  // Collect all dates in order
  const dates = sortedServices.map((s) => ({
    date: new Date(s.date).getUTCDate(),
    services: [s],
  }));
  
  // Define instrument rows in typical order
  const instrumentNames = [
    { key: 'guitar', pattern: /guitar/i },
    { key: 'keys', pattern: /key|piano|organ/i },
    { key: 'drums', pattern: /drum|percussion/i },
    { key: 'bass', pattern: /bass/i },
    { key: 'lead guitar', pattern: /lead guitar/i },
    { key: 'acoustic', pattern: /acoustic/i },
  ];
  
  const knownInstruments = [
    'Guitar',
    'Keys',
    'Drums',
    'Bass',
    'Lead Guitar',
    'Acoustic Guitar',
    'Electric Guitar',
  ];
  
  // Find all unique instruments from assignments
  const allInstrumentRows = new Set<string>();
  sortedServices.forEach((s) => {
    (s.assignments || []).forEach((a) => {
      const inst = a.instrument?.name || a.role?.name || '';
      if (inst) allInstrumentRows.add(inst);
    });
  });
  
  // Build rows - prioritize common ones, then others
  const rows: string[] = ['Guitar/s', 'Keys', 'Drums', 'Bass'];
  // Add any other instruments
  Array.from(allInstrumentRows).forEach((inst) => {
    const lower = inst.toLowerCase();
    if (!rows.some((r) => r.toLowerCase().includes(lower.split(' ')[0]))) {
      rows.push(inst);
    }
  });
  
  // Draw header row
  const colWidth = (pageWidth - margin * 2) / (dates.length + 1);
  const startY = y;
  
  // Date header
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('Date', margin, y);
  doc.rect(margin, y - 3, colWidth, 5);
  
  // Date columns
  dates.forEach((d, i) => {
    const x = margin + colWidth + i * colWidth;
    doc.text(d.date.toString(), x + colWidth / 2 - 2, y, { align: 'center' });
    doc.rect(x, y - 3, colWidth, 5);
  });
  y += 5;
  doc.rect(margin, y - 3, pageWidth - margin * 2, 0.5); // line
  y += 3;
  
  doc.setFont('helvetica', 'normal');
  
  // Draw each row
  rows.forEach((rowName) => {
    doc.setFontSize(8);
    doc.text(rowName, margin, y);
    doc.rect(margin, y - 3, colWidth, 5);
    
    dates.forEach((d, i) => {
      const x = margin + colWidth + i * colWidth;
      // Find assignments for this instrument in this service
      const service = d.services[0];
      const assignments = (service.assignments || []).filter((a) => {
        const instName = (a.instrument?.name || a.role?.name || '').toLowerCase();
        const rowLower = rowName.toLowerCase();
        if (rowLower === 'guitar/s') {
          return instName.includes('guitar');
        }
        if (rowLower === 'keys') {
          return instName.includes('key') || instName.includes('piano') || instName.includes('organ');
        }
        if (rowLower === 'drums') {
          return instName.includes('drum') || instName.includes('percussion');
        }
        if (rowLower === 'bass') {
          return instName.includes('bass');
        }
        return instName.includes(rowLower);
      });
      const names = assignments.map((a) => a.member?.full_name || '').filter(Boolean).join(', ');
      doc.text(names, x + 2, y, { maxWidth: colWidth - 4 });
      doc.rect(x, y - 3, colWidth, 5);
    });
    y += 5;
    if (y > pageHeight - 30) {
      doc.addPage();
      y = margin + 10;
    }
  });
  doc.rect(margin, y - 3, pageWidth - margin * 2, 0.5); // bottom line

  return doc;
}
