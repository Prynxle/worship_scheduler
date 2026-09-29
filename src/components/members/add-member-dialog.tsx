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

export interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (member: Member) => void;
}

async function getAuthHeaders() {
  const session = (await getSupabaseClient().auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : null;
}

export function AddMemberDialog({ open, onOpenChange, onCreated }: AddMemberDialogProps) {
  const [fullName, setFullName] = useState('');
  const [loginName, setLoginName] = useState('');
  const [nickname, setNickname] = useState('');
  const [gender, setGender] = useState(GENDER_NONE);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [instrumentIds, setInstrumentIds] = useState<string[]>([]);

  const [options, setOptions] = useState<OptionsPayload | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const resetForm = useCallback(() => {
    setFullName('');
    setLoginName('');
    setNickname('');
    setGender(GENDER_NONE);
    setRoleIds([]);
    setInstrumentIds([]);
    setError('');
  }, []);

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

  // Fetch the pickers shortly after the dialog opens. Deferring out of the
  // effect body keeps the options request from being a synchronous setState
  // cascade, and the cleanup cancels the first call under StrictMode's double
  // effect so the list is fetched once.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => { void loadOptions(); }, 0);
    return () => clearTimeout(timer);
  }, [open, loadOptions]);

  // Clearing on close (rather than in the effect) means a cancelled add never
  // leaks into the next one without an extra render on mount.
  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  function toggle(list: string[], setList: (next: string[]) => void, id: string, checked: boolean) {
    setList(checked ? [...list, id] : list.filter((item) => item !== id));
  }

  async function submit() {
    const trimmedName = fullName.trim();
    const trimmedLogin = loginName.trim();
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
      const response = await fetch('/api/members', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: trimmedName,
          login_name: trimmedLogin,
          nickname: nickname.trim() || null,
          gender: gender === GENDER_NONE ? null : gender,
          role_ids: roleIds,
          instrument_ids: instrumentIds,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { member?: Member; error?: string } | null;
      if (!response.ok) {
        setError(payload?.error ?? 'Could not add the member.');
        return;
      }
      if (payload?.member) {
        onCreated(payload.member);
      }
      resetForm();
      handleOpenChange(false);
    } catch {
      setError('Could not add the member. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const roleOptions = options?.roles ?? [];
  const instrumentOptions = options?.instruments ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Add someone to the worship roster. The login name is what the member types to sign in, so keep it
            short and recognisable.
          </DialogDescription>
        </DialogHeader>

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
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
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
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
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
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                maxLength={100}
                autoComplete="off"
                placeholder="Zed"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-gender">Gender</Label>
              <Select value={gender} onValueChange={(value) => setGender(value ?? GENDER_NONE)}>
                <SelectTrigger id="member-gender" className="h-10 w-full">
                  <SelectValue placeholder="Not specified">
                    {gender === GENDER_NONE ? 'Not specified' : gender}
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
                      checked={roleIds.includes(role.id)}
                      onCheckedChange={(checked) => toggle(roleIds, setRoleIds, role.id, checked)}
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
                      checked={instrumentIds.includes(instrument.id)}
                      onCheckedChange={(checked) => toggle(instrumentIds, setInstrumentIds, instrument.id, checked)}
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
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || optionsLoading}>
              {submitting ? 'Adding…' : 'Add member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
