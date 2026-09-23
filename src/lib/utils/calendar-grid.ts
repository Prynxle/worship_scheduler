export type CalendarCell = {
  date: Date;
  iso: string;
  inMonth: boolean;
  isToday: boolean;
};

const DAY_MS = 86_400_000;

function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCalendarGrid(
  month: number,
  year: number,
  today: Date = new Date()
): CalendarCell[] {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayIso = toIso(todayStart);
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getTime() + index * DAY_MS);
    const iso = toIso(date);
    return { date, iso, inMonth: iso.startsWith(monthKey), isToday: iso === todayIso };
  });
}
