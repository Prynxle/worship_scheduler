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

function formatMemberNames(names: string[]): string {
  return names.filter(Boolean).join(', ');
}

export function generateSchedulePDF(data: ScheduleForExport): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
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
  const name = data.churchName || 'Worship Schedule';
  const nameY = logoY + logoSize / 2 + 2;
  const nameX = margin + logoSize + 4;
  doc.text(name, nameX, nameY);
  y = Math.max(logoY + logoSize + 6, margin + 20);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(monthYear + ' Worship Team Singers', margin, y);
  y += 2;
  doc.setDrawColor(0, 0, 0);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;

  const sortedServices = [...data.services].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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
    const leaderName = service.leader_name !== 'Unassigned' ? service.leader_name : '';
    const backupNames = (service.backup_singers || []).map((b) => b.name).filter((n) => n !== 'Unassigned');
    const devotionName = service.devotion_name || '';
    const dateNum = new Date(service.date).getUTCDate().toString();

    doc.setFontSize(8);
    doc.text(dateNum, margin, y);
    if (leaderName) doc.text(leaderName, margin + 20, y, { maxWidth: 35 });
    if (backupNames.length) doc.text(formatMemberNames(backupNames), margin + 60, y, { maxWidth: 55 });
    if (devotionName) doc.text(devotionName, margin + 120, y, { maxWidth: 45 });
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
    doc.text('No published or validated schedule found for the selected period.', margin, y);
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

  instrumentRowLabels.forEach((rowLabel) => {
    if (y + rowHeight > pageHeight - margin) {
      doc.addPage();
      y = margin + 10;
    }
    doc.text(rowLabel, margin + 1.5, y + 4, { maxWidth: colWidth - 3 });
    doc.rect(margin, y, colWidth, rowHeight);
    const rowLower = rowLabel.toLowerCase();
    dates.forEach((entry, index) => {
      const x = margin + colWidth * (index + 1);
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
      doc.text(names, x + 1.5, y + 4, { maxWidth: colWidth - 3 });
      doc.rect(x, y, colWidth, rowHeight);
    });
    y += rowHeight;
  });

  return doc;
}
