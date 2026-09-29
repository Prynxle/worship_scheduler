'use client';

import { useCallback, useEffect, useState } from 'react';
import { MemberCard } from '@/components/members/member-card';
import { AddMemberDialog } from '@/components/members/add-member-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Filter, Users } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Member } from '@/lib/types/database';

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

  // Defer past the effect body so the initial load is not a synchronous setState
  // cascade. The cleanup cancels the first call under StrictMode's double effect
  // so the roster is fetched once.
  useEffect(() => {
    const timer = setTimeout(() => { void fetchMembers(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchMembers]);

  function retry() {
    setLoading(true);
    setError('');
    void fetchMembers();
  }

  const filteredMembers = members.filter((member) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      member.full_name.toLowerCase().includes(query) ||
      member.nickname?.toLowerCase().includes(query) ||
      member.roles?.some((r) => r.role?.name.toLowerCase().includes(query));

    if (activeTab === 'all') return matchesSearch;
    return matchesSearch && member.status === activeTab;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Members</h2>
          <p className="text-muted-foreground">Manage your ministry team members</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
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
        <Button variant="outline" disabled title="Filtering is not available yet.">
          <Filter className="h-4 w-4 mr-1" />
          Filter
        </Button>
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
            <p role="status" className="text-sm text-muted-foreground">
              Loading members…
            </p>
          ) : filteredMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {members.length === 0
                ? 'No members yet. Use “Add Member” to put someone on the roster.'
                : 'No members match this search.'}
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredMembers.map((member, i) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  index={i}
                  onEdit={() => console.log('Edit', member.id)}
                  onView={() => console.log('View', member.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AddMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(member) => setMembers((current) => [...current, member].sort((a, b) => a.full_name.localeCompare(b.full_name)))}
      />
    </div>
  );
}
