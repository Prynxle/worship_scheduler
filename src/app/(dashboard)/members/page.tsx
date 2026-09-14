'use client';

import { useState } from 'react';
import { MemberCard } from '@/components/members/member-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Filter, Users } from 'lucide-react';
import { Member } from '@/lib/types/database';

const mockMembers: Member[] = [
  {
    id: '1',
    church_id: 'church-1',
    full_name: 'Heidi',
    nickname: '',
    gender: 'female',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 85,
    total_assignments: 2,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '1', member_id: '1', role_id: 'r1', skill_level: 'expert', is_preferred: true, created_at: '2026-01-01', role: { id: 'r1', ministry_id: 'm1', name: 'Worship Leader', min_required: 1, max_allowed: 1, priority: 1, is_active: true, created_at: '2026-01-01' } },
      { id: '2', member_id: '1', role_id: 'r2', skill_level: 'advanced', is_preferred: true, created_at: '2026-01-01', role: { id: 'r2', ministry_id: 'm1', name: 'Singer', min_required: 3, max_allowed: 5, priority: 2, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [],
  },
  {
    id: '2',
    church_id: 'church-1',
    full_name: 'Feng',
    nickname: 'Tapeng',
    gender: 'male',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 90,
    total_assignments: 1,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '3', member_id: '2', role_id: 'r1', skill_level: 'advanced', is_preferred: true, created_at: '2026-01-01', role: { id: 'r1', ministry_id: 'm1', name: 'Worship Leader', min_required: 1, max_allowed: 1, priority: 1, is_active: true, created_at: '2026-01-01' } },
      { id: '4', member_id: '2', role_id: 'r2', skill_level: 'advanced', is_preferred: false, created_at: '2026-01-01', role: { id: 'r2', ministry_id: 'm1', name: 'Singer', min_required: 3, max_allowed: 5, priority: 2, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [
      { id: '1', member_id: '2', instrument_id: 'i1', skill_level: 'advanced', is_primary: true, created_at: '2026-01-01', instrument: { id: 'i1', ministry_id: 'm1', name: 'Guitar 1', is_required: true, min_count: 1, max_count: 1, created_at: '2026-01-01' } },
    ],
  },
  {
    id: '3',
    church_id: 'church-1',
    full_name: 'Zedrick',
    nickname: 'Zed',
    gender: 'male',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 80,
    total_assignments: 3,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '5', member_id: '3', role_id: 'r3', skill_level: 'expert', is_preferred: true, created_at: '2026-01-01', role: { id: 'r3', ministry_id: 'm1', name: 'Instrumentalist', min_required: 4, max_allowed: 6, priority: 3, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [
      { id: '2', member_id: '3', instrument_id: 'i1', skill_level: 'expert', is_primary: true, created_at: '2026-01-01', instrument: { id: 'i1', ministry_id: 'm1', name: 'Guitar 1', is_required: true, min_count: 1, max_count: 1, created_at: '2026-01-01' } },
      { id: '3', member_id: '3', instrument_id: 'i2', skill_level: 'intermediate', is_primary: false, fallback_member_id: '3', created_at: '2026-01-01', instrument: { id: 'i2', ministry_id: 'm1', name: 'Piano', is_required: true, min_count: 1, max_count: 1, created_at: '2026-01-01' } },
    ],
  },
  {
    id: '4',
    church_id: 'church-1',
    full_name: 'Kass',
    nickname: '',
    gender: 'female',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 75,
    total_assignments: 2,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '6', member_id: '4', role_id: 'r3', skill_level: 'advanced', is_preferred: true, created_at: '2026-01-01', role: { id: 'r3', ministry_id: 'm1', name: 'Instrumentalist', min_required: 4, max_allowed: 6, priority: 3, is_active: true, created_at: '2026-01-01' } },
      { id: '7', member_id: '4', role_id: 'r4', skill_level: 'advanced', is_preferred: false, created_at: '2026-01-01', role: { id: 'r4', ministry_id: 'm1', name: 'Devotion', min_required: 1, max_allowed: 1, priority: 4, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [
      { id: '4', member_id: '4', instrument_id: 'i2', skill_level: 'advanced', is_primary: true, created_at: '2026-01-01', instrument: { id: 'i2', ministry_id: 'm1', name: 'Piano', is_required: true, min_count: 1, max_count: 1, created_at: '2026-01-01' } },
    ],
  },
  {
    id: '5',
    church_id: 'church-1',
    full_name: 'Simone',
    nickname: '',
    gender: 'female',
    status: 'active',
    max_monthly_assignments: 4,
    priority_score: 70,
    total_assignments: 4,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '8', member_id: '5', role_id: 'r3', skill_level: 'expert', is_preferred: true, created_at: '2026-01-01', role: { id: 'r3', ministry_id: 'm1', name: 'Instrumentalist', min_required: 4, max_allowed: 6, priority: 3, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [
      { id: '5', member_id: '5', instrument_id: 'i3', skill_level: 'expert', is_primary: true, created_at: '2026-01-01', instrument: { id: 'i3', ministry_id: 'm1', name: 'Drums', is_required: true, min_count: 1, max_count: 1, created_at: '2026-01-01' } },
    ],
  },
];

export default function MembersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const filteredMembers = mockMembers.filter((member) => {
    const matchesSearch =
      member.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.nickname?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.roles?.some((r) =>
        r.role?.name.toLowerCase().includes(searchQuery.toLowerCase())
      );

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
        <Button>
          <Plus className="h-4 w-4 mr-1" />
          Add Member
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search members..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-secondary/50"
          />
        </div>
        <Button variant="outline">
          <Filter className="h-4 w-4 mr-1" />
          Filter
        </Button>
        <Button variant="outline">
          <Users className="h-4 w-4 mr-1" />
          {mockMembers.length} Members
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="inactive">Inactive</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
