'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { getSupabaseClient } from '@/lib/supabase/client';

type MemberInfo = { id: string; full_name: string; role: string; phone?: string | null };

export default function MemberPage() {
  const router = useRouter();
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [week, setWeek] = useState('1');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = getSupabaseClient().auth.getSession().then(async ({ data }) => {
      if (!data.session) return router.replace('/login');
      const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) return router.replace('/dashboard');
      const result = await response.json() as { user: { member_id: string | null; role: string; member_name?: string | null; phone?: string | null } };
      if (result.user.role !== 'member' || !result.user.member_id) return router.replace('/dashboard');
      setMember({ id: result.user.member_id, full_name: result.user.member_name ?? 'Your profile', role: result.user.role, phone: result.user.phone });
    });
    return () => { void token; };
  }, [router]);

  async function submitAvailability() {
    const session = (await getSupabaseClient().auth.getSession()).data.session;
    if (!session || !member) return;
    const response = await fetch('/api/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ type: 'weekly', week_number: Number(week) }),
    });
    setMessage(response.ok ? 'Availability request submitted.' : 'We could not save that request.');
  }

  if (!member) return null;
  return (
    <div className="max-w-3xl space-y-6">
      <div><h1 className="text-2xl font-semibold">My workspace</h1><p className="text-muted-foreground">Only your profile and availability are visible here.</p></div>
      <Card><CardHeader><CardTitle>My profile</CardTitle></CardHeader><CardContent><p className="font-medium">{member.full_name}</p><p className="text-sm text-muted-foreground">Worship team member</p></CardContent></Card>
      <Card><CardHeader><CardTitle>My availability</CardTitle></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label htmlFor="week">Unavailable week</Label><Input id="week" type="number" min="1" max="5" value={week} onChange={(event) => setWeek(event.target.value)} /></div><Button onClick={submitAvailability}>Submit request</Button>{message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}</CardContent></Card>
    </div>
  );
}
