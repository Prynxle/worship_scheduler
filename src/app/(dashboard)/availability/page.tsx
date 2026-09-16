'use client';

import { useCallback, useEffect, useState } from 'react';
import { AvailabilityCalendar } from '@/components/members/availability-calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Filter } from 'lucide-react';
import { Availability } from '@/lib/types/database';
import { getSupabaseClient } from '@/lib/supabase/client';

type StaffMember = { id: string; full_name: string };

async function getAuthHeaders() {
  const session = (await getSupabaseClient().auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : null;
}

export default function AvailabilityPage() {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [selectedMember, setSelectedMember] = useState('');
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadMembers() {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError('Your session has expired. Please sign in again.');
        return;
      }
      const response = await fetch('/api/members?status=active', { headers });
      if (!response.ok) {
        setError('Could not load members for this church.');
        return;
      }
      const result = await response.json() as { members: StaffMember[] };
      setMembers(result.members);
      setSelectedMember((current) => current || result.members[0]?.id || '');
    }
    void loadMembers();
  }, []);

  const loadAvailability = useCallback(async () => {
    if (!selectedMember) {
      return;
    }
    const headers = await getAuthHeaders();
    if (!headers) {
      setError('Your session has expired. Please sign in again.');
      return;
    }
    const response = await fetch(`/api/availability?member_id=${encodeURIComponent(selectedMember)}`, { headers });
    if (!response.ok) {
      setError('Could not load availability for this member.');
      return;
    }
    const result = await response.json() as { availabilities: Availability[] };
    setAvailabilities(result.availabilities);
  }, [selectedMember]);

  useEffect(() => {
    const refresh = async () => {
      await loadAvailability();
    };
    void refresh();
  }, [loadAvailability]);

  useEffect(() => {
    if (!selectedMember) {
      return;
    }
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`availability-changes-${selectedMember}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'availability',
          filter: `member_id=eq.${selectedMember}`,
        },
        () => {
          void loadAvailability();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedMember, loadAvailability]);

  const selectedMemberName = members.find((member) => member.id === selectedMember)?.full_name || '';

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
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-3">
        <Select value={selectedMember} onValueChange={(value) => value && setSelectedMember(value)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select member">
              {(value: string) => members.find((member) => member.id === value)?.full_name ?? 'Select member'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {members.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.full_name}
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
        availabilities={availabilities}
        currentMonth={currentMonth}
        currentYear={currentYear}
        onPreviousMonth={handlePreviousMonth}
        onNextMonth={handleNextMonth}
      />

      <Card className="card-glow">
        <CardHeader>
          <CardTitle>Recent Unavailability Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {availabilities.map((availability) => {
              return (
                <div
                  key={availability.id}
                  className="flex items-center justify-between rounded-lg border border-border p-4 hover-surface cursor-default"
                >
                  <div>
                    <div className="font-medium text-foreground">{selectedMemberName}</div>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={availability.status !== 'pending'}
                      onClick={async () => {
                        const headers = await getAuthHeaders();
                        if (!headers) {
                          setError('Your session has expired. Please sign in again.');
                          return;
                        }
                        const response = await fetch('/api/availability', {
                          method: 'PUT',
                          headers: { ...headers, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: availability.id, status: 'approved' }),
                        });
                        if (response.ok) {
                          setAvailabilities((current) =>
                            current.map((item) =>
                              item.id === availability.id ? { ...item, status: 'approved' } : item
                            )
                          );
                        }
                      }}
                    >
                      {availability.status === 'pending' ? 'Approve' : 'Reviewed'}
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
