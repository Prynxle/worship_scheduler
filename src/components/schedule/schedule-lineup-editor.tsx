'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isWorshipLeaderRoleName } from '@/lib/scheduling/role-classifier';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2 } from 'lucide-react';

export interface EditableAssignment {
  id: string;
  member_id: string;
  member_name: string;
  role_id: string;
  role_name: string;
  instrument_id: string | null;
  instrument_name: string | null;
  is_leader: boolean;
}

export interface AssignmentOption {
  id: string;
  full_name?: string;
  name?: string;
}

/**
 * The coordinator override surface, mirrored from the server allowlist.
 *
 * These are the ONLY two rules a human may override, and each is a licence to
 * knowingly book a conflict. Every other constraint (inactive member, two
 * leaders, unqualified leader, monthly limit, duplicate role) is refused by the
 * server regardless of what is ticked here, so the labels say what is being
 * overridden rather than reading as a generic "ignore warnings" switch.
 */
const OVERRIDE_AXES = [
  { key: 'availability' as const, label: "Override a member's availability", detail: 'Permits assigning someone marked unavailable for this week.' },
  { key: 'instrument_qualification' as const, label: "Override an instrument skill check", detail: 'Permits assigning someone with no recorded skill for that instrument.' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceId: string;
  scheduleVersion: number;
  assignments: EditableAssignment[];
  members: Array<{ id: string; full_name: string }>;
  roles: AssignmentOption[];
  instruments: AssignmentOption[];
  /** Licences already recorded on this service, so the dialog shows live state. */
  activeOverrides?: { availability?: boolean; instrument_qualification?: boolean };
  onSaved: () => void;
}

type EditRow = { key: string; member_id: string; role_id: string; instrument_id: string; is_leader: boolean };
type OverrideState = { availability: boolean; instrument_qualification: boolean };

export function ScheduleLineupEditor({ open, onOpenChange, serviceId, scheduleVersion, assignments, members, roles, instruments, activeOverrides, onSaved }: Props) {
  const [rows, setRows] = useState<EditRow[]>([]);
  const [originalRows, setOriginalRows] = useState('[]');
  const [overrides, setOverrides] = useState<OverrideState>({ availability: false, instrument_qualification: false });
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Initialize the local edit buffer from the selected service whenever it opens.
  useEffect(() => {
    if (!open) return;
    const initialRows = assignments.map((item, index) => ({ key: `${item.id}-${index}`, member_id: item.member_id, role_id: item.role_id, instrument_id: item.instrument_id ?? '', is_leader: item.is_leader }));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(initialRows);
    setOriginalRows(JSON.stringify(initialRows.map(({ member_id, role_id, instrument_id, is_leader }) => ({ member_id, role_id, instrument_id, is_leader }))));
    setOverrides({ availability: activeOverrides?.availability === true, instrument_qualification: activeOverrides?.instrument_qualification === true });
    setReason('');
    setError('');
  }, [open, assignments, activeOverrides]);

  const currentRows = JSON.stringify(rows.map(({ member_id, role_id, instrument_id, is_leader }) => ({ member_id, role_id, instrument_id, is_leader })));
  const hasUnsavedChanges = currentRows !== originalRows;
  // A licence is an audited decision, so the server refuses one without a reason.
  // Requiring it here as well means the coordinator is told before the round trip
  // rather than after, and it keeps the disabled state honest about why.
  const hasActiveAxis = overrides.availability || overrides.instrument_qualification;
  const overridesChanged = overrides.availability !== (activeOverrides?.availability === true)
    || overrides.instrument_qualification !== (activeOverrides?.instrument_qualification === true);
  const reasonMissing = hasActiveAxis && !reason.trim();
  const requestClose = (nextOpen: boolean) => {
    if (!nextOpen && hasUnsavedChanges && !window.confirm('Discard your unsaved lineup changes?')) return;
    onOpenChange(nextOpen);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const session = (await getSupabaseClient().auth.getSession()).data.session;
      if (!session) throw new Error('Your session has expired. Sign in again to save this lineup.');
      const response = await fetch(`/api/schedule/${encodeURIComponent(serviceId)}/assignments`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_version: scheduleVersion,
          assignments: rows.map(({ member_id, role_id, instrument_id, is_leader }) => ({ member_id, role_id, instrument_id: instrument_id || null, is_leader })),
          // Only checked axes are sent. The server stores the set verbatim, so
          // omitting an axis CLEARS a previously recorded licence rather than
          // silently carrying it onto a lineup nobody re-reviewed.
          overrides,
          reason,
        }),
      });
      const payload = await response.json() as { error?: string; validation?: Array<{ severity: string; message: string }> };
      if (!response.ok) throw new Error(payload.error ?? payload.validation?.map((item) => item.message).join(' ') ?? 'Could not save this lineup.');
      onSaved();
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this lineup.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adjust service lineup</DialogTitle>
          <DialogDescription>Changes are checked against availability, ministry roles, assignment limits, and service requirements before they are saved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.key} className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor={`assignment-member-${index}`}>Member</Label>
                <Select value={row.member_id} onValueChange={(value) => value && setRows((current) => current.map((item) => item.key === row.key ? { ...item, member_id: value } : item))}>
                  <SelectTrigger id={`assignment-member-${index}`} className="w-full"><SelectValue placeholder="Choose member" /></SelectTrigger>
                  <SelectContent>{members.map((member) => <SelectItem key={member.id} value={member.id}>{member.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`assignment-role-${index}`}>Role</Label>
                <Select value={row.role_id} onValueChange={(value) => {
                  if (!value) return;
                  const role = roles.find((item) => item.id === value);
                  // The shared classifier, not a second inline `=== 'worship leader'`.
                  // The editor's marker and the server's Rule 7 check must agree on
                  // the same row, or saving marks a leader the server will refuse.
                  setRows((current) => current.map((item) => item.key === row.key ? { ...item, role_id: value, is_leader: role?.name ? isWorshipLeaderRoleName(role.name) : false } : item));
                }}>
                  <SelectTrigger id={`assignment-role-${index}`} className="w-full"><SelectValue placeholder="Choose role" /></SelectTrigger>
                  <SelectContent>{roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`assignment-instrument-${index}`}>Instrument</Label>
                <Select value={row.instrument_id || 'none'} onValueChange={(value) => value && setRows((current) => current.map((item) => item.key === row.key ? { ...item, instrument_id: value === 'none' ? '' : value } : item))}>
                  <SelectTrigger id={`assignment-instrument-${index}`} className="w-full"><SelectValue placeholder="No instrument" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No instrument</SelectItem>{instruments.map((instrument) => <SelectItem key={instrument.id} value={instrument.id}>{instrument.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" size="icon" aria-label={`Remove assignment ${index + 1}`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setRows((current) => [...current, { key: `new-${Date.now()}-${current.length}`, member_id: members[0]?.id ?? '', role_id: roles[0]?.id ?? '', instrument_id: '', is_leader: false }])} disabled={!members.length || !roles.length}>
            <Plus className="mr-2 h-4 w-4" />Add assignment
          </Button>
          <fieldset className="space-y-2 rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-medium">Coordinator override</legend>
            <p className="text-sm text-muted-foreground">
              These license exactly two rules. Everything else &mdash; an inactive member, two worship leaders, an
              unqualified leader, a duplicate role, or exceeding the monthly limit &mdash; is still refused.
            </p>
            {OVERRIDE_AXES.map((axis) => (
              <div key={axis.key} className="flex items-start gap-2">
                <input
                  id={`schedule-override-${axis.key}`}
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={overrides[axis.key]}
                  aria-describedby={`schedule-override-${axis.key}-detail`}
                  onChange={(event) => setOverrides((current) => ({ ...current, [axis.key]: event.target.checked }))}
                />
                <div className="space-y-0.5">
                  <Label htmlFor={`schedule-override-${axis.key}`}>{axis.label}</Label>
                  <p id={`schedule-override-${axis.key}-detail`} className="text-sm text-muted-foreground">{axis.detail}</p>
                </div>
              </div>
            ))}
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-override-reason">Reason {hasActiveAxis ? <span className="text-destructive">(required)</span> : '(for warning overrides)'}</Label>
            <Textarea id="schedule-override-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required when recording an override, and when saving a lineup with fairness or rotation warnings." aria-describedby={reasonMissing ? 'schedule-override-reason-required' : undefined} />
            {reasonMissing ? <p id="schedule-override-reason-required" className="text-sm text-destructive">Give a reason for the override. It is stored with the change as an audit record.</p> : null}
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => requestClose(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || reasonMissing || (!hasUnsavedChanges && !overridesChanged)}>{saving ? 'Saving…' : 'Save lineup'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
