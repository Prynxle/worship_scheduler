'use client';

import { useState } from 'react';
import { AvailabilityCalendar } from '@/components/members/availability-calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, Filter } from 'lucide-react';
import { Availability } from '@/lib/types/database';

const mockAvailabilities: Availability[] = [
  {
    id: '1',
    member_id: '1',
    church_id: 'church-1',
    type: 'weekly',
    week_number: 1,
    status: 'approved',
    created_at: '2026-08-01',
  },
  {
    id: '2',
    member_id: '1',
    church_id: 'church-1',
    type: 'weekly',
    week_number: 2,
    status: 'approved',
    created_at: '2026-08-01',
  },
  {
    id: '3',
    member_id: '1',
    church_id: 'church-1',
    type: 'weekly',
    week_number: 4,
    status: 'pending',
    created_at: '2026-08-01',
  },
];

const mockMembers = [
  { id: '1', name: 'Heidi' },
  { id: '2', name: 'Feng' },
  { id: '3', name: 'Zedrick' },
  { id: '4', name: 'Kass' },
  { id: '5', name: 'Simone' },
];

export default function AvailabilityPage() {
  const [selectedMember, setSelectedMember] = useState('1');
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  const memberAvailabilities = mockAvailabilities.filter(
    (a) => a.member_id === selectedMember
  );

  const selectedMemberName = mockMembers.find((m) => m.id === selectedMember)?.name || '';

  const handlePreviousMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Availability</h2>
          <p className="text-muted-foreground">Manage member availability and unavailability</p>
        </div>
        <Button>
          <Clock className="h-4 w-4 mr-1" />
          Add Unavailability
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={selectedMember} onValueChange={(value) => value && setSelectedMember(value)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select member" />
          </SelectTrigger>
          <SelectContent>
            {mockMembers.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline">
          <Filter className="h-4 w-4 mr-1" />
          Filter
        </Button>
      </div>

      <AvailabilityCalendar
        memberName={selectedMemberName}
        availabilities={memberAvailabilities}
        currentMonth={currentMonth}
        currentYear={currentYear}
        onPreviousMonth={handlePreviousMonth}
        onNextMonth={handleNextMonth}
        onAddAvailability={() => console.log('Add availability')}
      />

      <Card className="card-glow">
        <CardHeader>
          <CardTitle>Recent Unavailability Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {mockAvailabilities.map((availability) => {
              const member = mockMembers.find((m) => m.id === availability.member_id);
              return (
                <div
                  key={availability.id}
                  className="flex items-center justify-between rounded-lg border border-border p-4 hover-surface cursor-default"
                >
                  <div>
                    <div className="font-medium text-foreground">{member?.name}</div>
                    <div className="text-sm text-muted-foreground">
                      Week {availability.week_number} - {availability.type}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        availability.status === 'approved'
                          ? 'bg-primary/15 text-primary'
                          : availability.status === 'rejected'
                          ? 'bg-destructive/15 text-destructive'
                          : 'bg-[oklch(0.70_0.08_80)]/15 text-[oklch(0.70_0.08_80)]'
                      }`}
                    >
                      {availability.status}
                    </span>
                    <Button variant="ghost" size="sm">
                      Review
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
