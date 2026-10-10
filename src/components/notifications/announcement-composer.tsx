'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AnnouncementAudience, Member, Ministry } from '@/lib/types/database';

const MAX_TITLE_LENGTH = 255;
const MAX_MESSAGE_LENGTH = 5000;

const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  church: 'Whole church',
  ministry: 'A ministry',
  role: 'An account role',
  members: 'Named members',
};

const APP_ROLE_OPTIONS = [
  { value: 'admin', label: 'Admins' },
  { value: 'coordinator', label: 'Coordinators' },
  { value: 'member', label: 'Members' },
] as const;

async function authHeaders(): Promise<HeadersInit | null> {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : null;
}

type Option = { id: string; name: string };

interface AnnouncementComposerProps {
  /** Called after a successful publish so a surface can refresh its feed. */
  onPublished?: (recipients: number) => void;
}

/**
 * Compose form for a church-wide announcement, rendered on the Announcements
 * page for admin and coordinator accounts only. The route re-checks the role
 * server-side, so the page gate is a convenience, not the boundary.
 */
export function AnnouncementComposer({ onPublished }: AnnouncementComposerProps) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<AnnouncementAudience | ''>('');
  const [ministryId, setMinistryId] = useState('');
  const [appRole, setAppRole] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState('');

  const [ministries, setMinistries] = useState<Option[]>([]);
  const [members, setMembers] = useState<Option[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) {
      setOptionsError('Your session has expired. Sign in again to compose an announcement.');
      return;
    }

    try {
      const [ministriesResponse, membersResponse] = await Promise.all([
        fetch('/api/ministries', { headers }),
        fetch('/api/members?status=active', { headers }),
      ]);

      const ministriesPayload = await ministriesResponse.json().catch(() => null) as { ministries?: Ministry[] } | null;
      const membersPayload = await membersResponse.json().catch(() => null) as { members?: Member[] } | null;

      if (!ministriesResponse.ok || !Array.isArray(ministriesPayload?.ministries)) {
        throw new Error('Could not load ministries.');
      }
      if (!membersResponse.ok || !Array.isArray(membersPayload?.members)) {
        throw new Error('Could not load members.');
      }

      setMinistries(ministriesPayload.ministries.map((ministry) => ({ id: ministry.id, name: ministry.name })));
      setMembers(membersPayload.members.map((member) => ({ id: member.id, name: member.full_name })));
      setOptionsError(null);
    } catch {
      setOptionsError('Could not load the audience options. Reload the page and try again.');
    }
  }, []);

  useEffect(() => {
    // Deferred like EventManager's mount fetch: loadOptions() writes state,
    // and the set-state-in-effect rule wants that write out of the effect.
    const timer = setTimeout(() => { void loadOptions(); }, 0);
    return () => clearTimeout(timer);
  }, [loadOptions]);

  const resetDraft = () => {
    setTitle('');
    setMessage('');
    setAudience('');
    setMinistryId('');
    setAppRole('');
    setSelectedMemberIds([]);
    setMemberSearch('');
    setFormError(null);
  };

  const toggleMember = (memberId: string) => {
    setSelectedMemberIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    );
  };

  const filteredMembers = memberSearch.trim()
    ? members.filter((member) => member.name.toLowerCase().includes(memberSearch.trim().toLowerCase()))
    : members;

  const validate = (): string | null => {
    if (!title.trim()) return 'A title is required.';
    if (title.trim().length > MAX_TITLE_LENGTH) return `The title must be ${MAX_TITLE_LENGTH} characters or fewer.`;
    if (!message.trim()) return 'A message is required.';
    if (message.trim().length > MAX_MESSAGE_LENGTH) return `The message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`;
    if (!audience) return 'Choose who should receive this announcement.';
    if (audience === 'ministry' && !ministryId) return 'Choose a ministry.';
    if (audience === 'role' && !appRole) return 'Choose an account role.';
    if (audience === 'members' && selectedMemberIds.length === 0) return 'Select at least one member.';
    return null;
  };

  const audiencePayload = (): { type: AnnouncementAudience; ministry_id?: string; role?: string; member_ids?: string[] } => {
    if (audience === 'ministry') return { type: 'ministry', ministry_id: ministryId };
    if (audience === 'role') return { type: 'role', role: appRole };
    if (audience === 'members') return { type: 'members', member_ids: selectedMemberIds };
    return { type: 'church' };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setFormError(problem);
      setSuccess(null);
      return;
    }

    setFormError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error('Your session has expired. Sign in again to publish.');

      const response = await fetch('/api/announcements', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          audience: audiencePayload(),
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; announcement?: { recipients?: number } } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Could not publish the announcement.');

      const recipients = payload?.announcement?.recipients ?? 0;
      resetDraft();
      setSuccess(`Published to ${recipients} ${recipients === 1 ? 'person' : 'people'}.`);
      onPublished?.(recipients);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not publish the announcement.');
    } finally {
      setSubmitting(false);
    }
  };

  const hasDraft = Boolean(
    title || message || audience || ministryId || appRole || memberSearch || selectedMemberIds.length,
  );

  return (
    <Card className="card-glow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          New announcement
        </CardTitle>
        <CardDescription>
          Publish an in-app announcement to members of your church. It appears in their notification panel.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="announcement-title">Title</Label>
            <Input
              id="announcement-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="Sunday rehearsal moved to 4 PM"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="announcement-message">Message</Label>
            <Textarea
              id="announcement-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={4}
              placeholder="Write the announcement members will read."
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="announcement-audience">Audience</Label>
            <Select value={audience} onValueChange={(value) => {
              if (value === 'church' || value === 'ministry' || value === 'role' || value === 'members') {
                setAudience(value);
              }
              setFormError(null);
            }}>
              <SelectTrigger id="announcement-audience">
                <SelectValue placeholder="Choose who receives this" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(AUDIENCE_LABELS) as AnnouncementAudience[]).map((key) => (
                  <SelectItem key={key} value={key}>{AUDIENCE_LABELS[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {audience === 'ministry' && (
            <div className="space-y-2">
              <Label htmlFor="announcement-ministry">Ministry</Label>
              <Select value={ministryId} onValueChange={(value) => setMinistryId(value ?? '')}>
                <SelectTrigger id="announcement-ministry">
                  <SelectValue placeholder="Choose a ministry" />
                </SelectTrigger>
                <SelectContent>
                  {ministries.map((ministry) => (
                    <SelectItem key={ministry.id} value={ministry.id}>{ministry.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {audience === 'role' && (
            <div className="space-y-2">
              <Label htmlFor="announcement-role">Account role</Label>
              <Select value={appRole} onValueChange={(value) => setAppRole(value ?? '')}>
                <SelectTrigger id="announcement-role">
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>
                  {APP_ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {audience === 'members' && (
            <div className="space-y-2">
              <Label htmlFor="announcement-member-search">Members ({selectedMemberIds.length} selected)</Label>
              <Input
                id="announcement-member-search"
                value={memberSearch}
                onChange={(event) => setMemberSearch(event.target.value)}
                placeholder="Search members"
              />
              <div className="max-h-40 overflow-y-auto rounded-md border border-border/70 p-1">
                {filteredMembers.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">No members match.</p>
                ) : (
                  filteredMembers.map((member) => (
                    <label
                      key={member.id}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent/50"
                    >
                      <Checkbox
                        checked={selectedMemberIds.includes(member.id)}
                        onCheckedChange={() => toggleMember(member.id)}
                      />
                      <span className="truncate">{member.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {optionsError && <p className="text-sm text-destructive" role="alert">{optionsError}</p>}
          {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
          {success && (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400" role="status">
              <Check className="size-4" /> {success}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => { resetDraft(); setSuccess(null); }}
              disabled={submitting || !hasDraft}
            >
              Clear
            </Button>
            <Button
              type="submit"
              disabled={submitting || Boolean(optionsError) || !title.trim() || !message.trim()}
            >
              {submitting ? (
                <><Loader2 className="size-4 animate-spin" /> Publishing…</>
              ) : (
                <>Publish announcement</>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
