'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Member } from '@/lib/types/database';

type Option = { id: string; ministry_id: string; name: string; ministry_name: string | null };
type OptionsPayload = { roles: Option[]; instruments: Option[] };

const GENDER_NONE = 'unspecified';

export interface MemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The member being edited, or null to add someone new. One form serves both
   * because the fields and the validation are identical -- a second form would
   * be a second place for the login-name lowercase rule to go missing.
   */
  member?: Member | null;
  onSaved: (member: Member) => void;
}

interface FormState {
  fullName: string;
  loginName: string;
  nickname: string;
  gender: string;
  status: string;
  roleIds: string[];
  instrumentIds: string[];
}

function seedFrom(member: Member | null): FormState {
  return {
    fullName: member?.full_name ?? '',
    loginName: member?.login_name ?? '',
    nickname: member?.nickname ?? '',
    gender: member?.gender ?? GENDER_NONE,
    status: member?.status ?? 'active',
    // Compare against the ids on the join rows, not the joined names, so a role
    // that has since been deleted still round-trips as "not selected" instead of
    // being silently re-created on save.
    roleIds: (member?.roles ?? []).map((row) => row.role_id),
    instrumentIds: (member?.skills ?? []).map((row) => row.instrument_id),
  };
}

async function getAuthHeaders() {
  const session = (await getSupabaseClient().auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : null;
}

export function MemberDialog({ open, onOpenChange, member = null, onSaved }: MemberDialogProps) {
  const editing = Boolean(member);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit member' : 'Add member'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update this member’s details, roles and instruments. Roles and instruments are replaced by whatever is selected here.'
              : 'Add someone to the worship roster. The login name is what the member types to sign in, so keep it short and recognisable.'}
          </DialogDescription>
        </DialogHeader>

        {/*
          Mounted only while open, and keyed on the member id. That is what seeds
          the fields: a fresh mount runs the initialisers, and clicking Edit on a
          different member while the dialog is open gets a different key, so the
          form rebuilds instead of showing the previous member's values. Doing
          this in an effect instead would set state during the effect body and
          cost an extra render pass on every open.
        */}
        {open ? (
          <MemberForm
            key={member?.id ?? 'new'}
            member={member}
            onSaved={onSaved}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MemberForm({ member, onSaved, onDone }: { member: Member | null; onSaved: (m: Member) => void; onDone: () => void }) {
  const editing = Boolean(member);
  const [form, setForm] = useState<FormState>(() => seedFrom(member));

  const [options, setOptions] = useState<OptionsPayload | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError('');
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setOptionsError('Your session has expired. Please sign in again.');
        return;
      }
      const response = await fetch('/api/members/options', { headers });
      if (!response.ok) {
        setOptionsError('Could not load the role and instrument lists.');
        return;
      }
      setOptions((await response.json()) as OptionsPayload);
    } catch {
      setOptionsError('Could not load the role and instrument lists.');
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  // Fetch the pickers shortly after the form mounts. Deferring out of the effect
  // body keeps the options request from being a synchronous setState cascade, and
  // the cleanup cancels the first call under StrictMode's double effect so the
  // list is fetched once.
  useEffect(() => {
    const timer = setTimeout(() => { void loadOptions(); }, 0);
    return () => clearTimeout(timer);
  }, [loadOptions]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggle(key: 'roleIds' | 'instrumentIds', id: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      [key]: checked ? [...current[key], id] : current[key].filter((item) => item !== id),
    }));
  }

  async function submit() {
    const trimmedName = form.fullName.trim();
    const trimmedLogin = form.loginName.trim();
    if (!trimmedName || !trimmedLogin) {
      setError('A full name and a login name are both required.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError('Your session has expired. Please sign in again.');
        return;
      }
      const response = await fetch(editing ? `/api/members/${member!.id}` : '/api/members', {
        method: editing ? 'PATCH' : 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: trimmedName,
          login_name: trimmedLogin,
          nickname: form.nickname.trim() || null,
          gender: form.gender === GENDER_NONE ? null : form.gender,
          // Status is only sent when editing, so adding a member keeps the
          // server-side 'active' default rather than a second client default
          // that could drift from it.
          ...(editing ? { status: form.status } : {}),
          role_ids: form.roleIds,
          instrument_ids: form.instrumentIds,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { member?: Member; error?: string } | null;
      if (!response.ok) {
        setError(payload?.error ?? (editing ? 'Could not save the member.' : 'Could not add the member.'));
        return;
      }
      if (payload?.member) {
        onSaved(payload.member);
      }
      onDone();
    } catch {
      setError(editing ? 'Could not save the member. Please try again.' : 'Could not add the member. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const roleOptions = options?.roles ?? [];
  const instrumentOptions = options?.instruments ?? [];

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="member-full-name">Full name</Label>
        <Input
          id="member-full-name"
          value={form.fullName}
          onChange={(event) => update('fullName', event.target.value)}
          required
          maxLength={255}
          autoComplete="off"
          placeholder="Zedrick Paul"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="member-login-name">Login name</Label>
        <Input
          id="member-login-name"
          value={form.loginName}
          onChange={(event) => update('loginName', event.target.value)}
          required
          maxLength={100}
          autoComplete="off"
          aria-describedby="member-login-name-hint"
          placeholder="zedrick"
        />
        <p id="member-login-name-hint" className="text-xs text-muted-foreground">
          Stored in lowercase. The member signs in by typing this name.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="member-nickname">Nickname (optional)</Label>
          <Input
            id="member-nickname"
            value={form.nickname}
            onChange={(event) => update('nickname', event.target.value)}
            maxLength={100}
            autoComplete="off"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="member-gender">Gender</Label>
          <Select value={form.gender} onValueChange={(value) => update('gender', value ?? GENDER_NONE)}>
            <SelectTrigger id="member-gender" className="h-10 w-full">
              <SelectValue placeholder="Not specified">
                {form.gender === GENDER_NONE ? 'Not specified' : form.gender}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Label htmlFor="member-status">Status</Label>
          <Select value={form.status} onValueChange={(value) => update('status', value ?? 'active')}>
            <SelectTrigger id="member-status" className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Inactive members stay on the roster but cannot be assigned to a service.
          </p>
        </div>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Roles</legend>
        {optionsLoading ? (
          <p className="text-sm text-muted-foreground">Loading roles…</p>
        ) : optionsError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {optionsError}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadOptions()}>
              Try again
            </Button>
          </div>
        ) : roleOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">This church has no roles configured yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {roleOptions.map((role) => (
              <label
                key={role.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50 has-[[data-checked]]:border-primary/40 has-[[data-checked]]:bg-primary/5"
              >
                <Checkbox
                  checked={form.roleIds.includes(role.id)}
                  onCheckedChange={(checked) => toggle('roleIds', role.id, checked)}
                />
                <span>{role.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Instruments</legend>
        {optionsLoading ? (
          <p className="text-sm text-muted-foreground">Loading instruments…</p>
        ) : optionsError ? null : instrumentOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">This church has no instruments configured yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {instrumentOptions.map((instrument) => (
              <label
                key={instrument.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50 has-[[data-checked]]:border-primary/40 has-[[data-checked]]:bg-primary/5"
              >
                <Checkbox
                  checked={form.instrumentIds.includes(instrument.id)}
                  onCheckedChange={(checked) => toggle('instrumentIds', instrument.id, checked)}
                />
                <span>{instrument.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || optionsLoading}>
          {submitting ? (editing ? 'Saving…' : 'Adding…') : editing ? 'Save changes' : 'Add member'}
        </Button>
      </DialogFooter>
    </form>
  );
}
