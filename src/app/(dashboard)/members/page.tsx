'use client';

import { useCallback, useEffect, useState } from 'react';
import { MemberCard } from '@/components/members/member-card';
import { MemberDialog } from '@/components/members/member-dialog';
import { MemberFilters, type MemberFilterOption } from '@/components/members/member-filters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Users } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { filterMembers, isFiltering } from '@/lib/members/filter';
import { Member } from '@/lib/types/database';
import { MemberGridSkeleton } from '@/components/ui/loading-skeleton';

async function getAuthHeaders() {
  const session = (await getSupabaseClient().auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : null;
}

export default function MembersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const [roleOptions, setRoleOptions] = useState<MemberFilterOption[]>([]);
  const [instrumentOptions, setInstrumentOptions] = useState<MemberFilterOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [selectedInstrumentIds, setSelectedInstrumentIds] = useState<string[]>([]);

  const [editingMember, setEditingMember] = useState<Member | null>(null);

  const fetchMembers = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError('Your session has expired. Please sign in again.');
        return;
      }
      const response = await fetch('/api/members', { headers });
      if (!response.ok) {
        setError('Could not load the member list for this church.');
        return;
      }
      const result = (await response.json()) as { members: Member[] };
      setMembers(result.members ?? []);
    } catch {
      setError('Could not load the member list for this church.');
    } finally {
      setLoading(false);
    }
  }, []);

  // The filter labels come from the same tenant-scoped endpoint the dialog uses,
  // so the filter can never offer a role this church does not have. A failure
  // here is not fatal: the roster still renders, the filters just stay empty.
  const fetchFilterOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError('');
    try {
      const headers = await getAuthHeaders();
      if (!headers) throw new Error('Your session has expired. Please sign in again.');
      const response = await fetch('/api/members/options', { headers });
      if (!response.ok) throw new Error('Could not load member filter options.');
      const result = (await response.json()) as {
        roles?: MemberFilterOption[];
        instruments?: MemberFilterOption[];
      };
      setRoleOptions(result.roles ?? []);
      setInstrumentOptions(result.instruments ?? []);
    } catch {
      setOptionsError('Could not load role and instrument filters.');
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  // Defer past the effect body so the initial load is not a synchronous setState
  // cascade. The cleanup cancels the first call under StrictMode's double effect
  // so the roster is fetched once.
  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchMembers();
      void fetchFilterOptions();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchMembers, fetchFilterOptions]);

  function retry() {
    setLoading(true);
    setError('');
    void fetchMembers();
  }

  // Temporarily keep the control in place while leaving member creation
  // available for a future coordinator workflow change.
  function handleAddMemberClick() {}

  const filters = {
    searchQuery,
    status: activeTab,
    roleIds: selectedRoleIds,
    instrumentIds: selectedInstrumentIds,
  };
  const filteredMembers = filterMembers(members, filters);
  const hasNarrowing = isFiltering(filters);

  function handleSaved(saved: Member) {
    if (editingMember) {
      // Replace in place so the card keeps its position and the freshly saved
      // roles render immediately, rather than re-fetching the whole roster.
      setMembers((current) =>
        current
          .map((member) => (member.id === saved.id ? saved : member))
          .sort((a, b) => a.full_name.localeCompare(b.full_name)),
      );
      setEditingMember(null);
      return;
    }
    setMembers((current) => [...current, saved].sort((a, b) => a.full_name.localeCompare(b.full_name)));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Members</h2>
          <p className="text-muted-foreground">Manage your ministry team members</p>
        </div>
        <Button onClick={handleAddMemberClick}>
          <Plus className="h-4 w-4 mr-1" />
          Add Member
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Search members..."
            aria-label="Search members"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-secondary/50"
          />
        </div>
        <MemberFilters
          open={filterOpen}
          onOpenChange={setFilterOpen}
          roles={roleOptions}
          instruments={instrumentOptions}
          selectedRoleIds={selectedRoleIds}
          selectedInstrumentIds={selectedInstrumentIds}
          onSelectedRoleIdsChange={setSelectedRoleIds}
          onSelectedInstrumentIdsChange={setSelectedInstrumentIds}
          matchCount={filteredMembers.length}
          totalCount={members.length}
          optionsLoading={optionsLoading}
          optionsError={optionsError}
          onRetry={fetchFilterOptions}
        />
        <Button variant="outline">
          <Users className="h-4 w-4 mr-1" />
          {members.length} Members
        </Button>
      </div>

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="inactive">Inactive</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {loading ? (
            <MemberGridSkeleton />
          ) : filteredMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {members.length === 0
                ? 'No members yet. Use “Add Member” to put someone on the roster.'
                : hasNarrowing
                  ? 'No members match these filters.'
                  : 'No members match this search.'}
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredMembers.map((member, i) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  index={i}
                  onEdit={() => setEditingMember(member)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/*
        One dialog serves both create and edit, selected by which state is set.
        Rendering two <MemberDialog> instances meant two base-ui Dialog roots
        mounted at once, and only the first of those roots got the modal
        registration -- so opening the second one left the edit dialog's open
        state set but never rendered a popup. Editing was therefore the one
        action that appeared to do nothing. One root also drops the duplicated
        state and the duplicated onSaved wiring.
      */}
      <MemberDialog
        open={addOpen || editingMember !== null}
        member={editingMember}
        onOpenChange={(next) => {
          setAddOpen(next);
          if (!next) setEditingMember(null);
        }}
        onSaved={handleSaved}
      />
    </div>
  );
}
