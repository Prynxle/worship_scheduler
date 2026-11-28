'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Availability } from '@/lib/types/database';
import { getWeekDateRange, getWeeksInMonth } from '@/lib/utils/date-utils';
import { cn } from '@/lib/utils';

interface AvailabilityCalendarProps {
  memberName: string;
  availabilities: Availability[];
  currentMonth: number;
  currentYear: number;
  onPreviousMonth?: () => void;
  onNextMonth?: () => void;
  onAddAvailability?: () => void;
}

export function AvailabilityCalendar({
  memberName,
  availabilities,
  currentMonth,
  currentYear,
  onPreviousMonth,
  onNextMonth,
  onAddAvailability,
}: AvailabilityCalendarProps) {
  const monthName = new Date(currentYear, currentMonth).toLocaleString('default', {
    month: 'long',
  });

  const weeksInMonth = getWeeksInMonth(currentMonth, currentYear);
  const weekNumbers = Array.from({ length: weeksInMonth }, (_, i) => i + 1);

  const getWeekAvailability = (weekNumber: number) => {
    return availabilities.filter(
      (a) =>
        a.type === 'weekly' &&
        a.week_number === weekNumber &&
        (a.month === undefined || a.month === currentMonth) &&
        (a.year === undefined || a.year === currentYear)
    );
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isWeekPast = (weekNumber: number) => {
    const { start } = getWeekDateRange(weekNumber, currentMonth, currentYear);
    return start.getTime() < today.getTime();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-primary/15 text-primary border-primary/20';
      case 'rejected':
        return 'bg-destructive/15 text-destructive border-destructive/20';
      default:
        return 'bg-[oklch(0.70_0.08_80)]/15 text-[oklch(0.70_0.08_80)] border-[oklch(0.70_0.08_80)]/20';
    }
  };

  return (
    <Card className="card-glow">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex min-w-0 items-center gap-2">
            <Calendar className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">Availability - {memberName}</span>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="icon" onClick={onPreviousMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="font-medium text-foreground">
              {monthName} {currentYear}
            </span>
            <Button variant="outline" size="icon" onClick={onNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {onAddAvailability ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={onAddAvailability}>
                <Plus className="h-4 w-4 mr-1" />
                Add Unavailability
              </Button>
            </div>
          ) : null}

          <div className="grid gap-3">
            {weekNumbers.map((weekNumber) => {
              const { start } = getWeekDateRange(weekNumber, currentMonth, currentYear);
              const weekAvail = getWeekAvailability(weekNumber).filter(
                (a) => a.status !== 'rejected'
              );
              const past = isWeekPast(weekNumber);

              return (
                <div
                  key={weekNumber}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-4',
                    past ? 'bg-muted/60 opacity-50' : 'hover-surface cursor-default'
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">
                      Week {weekNumber}
                      {past ? ' (past)' : null}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {weekAvail.length > 0 ? (
                      weekAvail.map((avail) => (
                        <Badge key={avail.id} className={getStatusColor(avail.status)}>
                          {avail.status === 'approved' ? 'Unavailable' : 'Pending'}
                        </Badge>
                      ))
                    ) : (
                      <Badge className="bg-primary/15 text-primary border-primary/20">Available</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
