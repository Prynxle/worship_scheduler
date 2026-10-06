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

  return doc;
}
