'use client';

import { useState } from 'react';
import { MinistryConfig } from '@/components/ministries/ministry-config';
import { Button } from '@/components/ui/button';
import { Plus, Music, Settings } from 'lucide-react';
import { Ministry, Role } from '@/lib/types/database';

const mockMinistries: Ministry[] = [
  {
    id: '1',
    church_id: 'church-1',
    name: 'Worship Team',
    description: 'Main worship ministry',
    config: {
      min_members: 8,
      max_members: 12,
      requires_leader: true,
      allows_dual_role: true,
      auto_generate: true,
    },
    priority: 1,
    is_active: true,
    created_at: '2026-01-01',
  },
  {
    id: '2',
    church_id: 'church-1',
    name: 'Sound Team',
    description: 'Audio and sound system',
    config: {
      min_members: 2,
      max_members: 4,
      requires_leader: false,
      allows_dual_role: false,
      auto_generate: false,
    },
    priority: 2,
    is_active: true,
    created_at: '2026-01-01',
  },
  {
    id: '3',
    church_id: 'church-1',
    name: 'Projection Team',
    description: 'Visual presentation',
    config: {
      min_members: 1,
      max_members: 3,
      requires_leader: false,
      allows_dual_role: false,
      auto_generate: false,
    },
    priority: 3,
    is_active: true,
    created_at: '2026-01-01',
  },
];

const mockRoles: Role[] = [
  { id: '1', ministry_id: '1', name: 'Worship Leader', min_required: 1, max_allowed: 1, priority: 1, is_active: true, created_at: '2026-01-01' },
  { id: '2', ministry_id: '1', name: 'Singer', min_required: 3, max_allowed: 5, priority: 2, is_active: true, created_at: '2026-01-01' },
  { id: '3', ministry_id: '1', name: 'Instrumentalist', min_required: 4, max_allowed: 6, priority: 3, is_active: true, created_at: '2026-01-01' },
  { id: '4', ministry_id: '1', name: 'Devotion', min_required: 1, max_allowed: 1, priority: 4, is_active: true, created_at: '2026-01-01' },
];

export default function MinistriesPage() {
  const [selectedMinistry, setSelectedMinistry] = useState('1');

  const currentMinistry = mockMinistries.find((m) => m.id === selectedMinistry);
  const ministryRoles = mockRoles.filter((r) => r.ministry_id === selectedMinistry);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Ministries</h2>
          <p className="text-muted-foreground">Configure ministry roles and rules</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-1" />
          Add Ministry
        </Button>
      </div>

      <div className="flex items-center gap-3">
        {mockMinistries.map((ministry) => (
          <Button
            key={ministry.id}
            variant={selectedMinistry === ministry.id ? 'default' : 'outline'}
            onClick={() => setSelectedMinistry(ministry.id)}
          >
            <Music className="h-4 w-4 mr-1" />
            {ministry.name}
          </Button>
        ))}
      </div>

      {currentMinistry && (
        <MinistryConfig
          ministry={currentMinistry}
          roles={ministryRoles}
          onAddRole={() => console.log('Add role')}
          onEditRole={(role) => console.log('Edit role', role.id)}
          onDeleteRole={(role) => console.log('Delete role', role.id)}
          onUpdateConfig={(config) => console.log('Update config', config)}
        />
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Ministry Rules</h3>
          <div className="space-y-2">
            {[
              { name: 'Availability Check', description: 'Members must be available', enabled: true },
              { name: 'Assignment Limit', description: 'Monthly assignment cap', enabled: true },
              { name: 'Role Validation', description: 'Members must be qualified', enabled: true },
              { name: 'Cooldown', description: 'Avoid consecutive weeks', enabled: true },
              { name: 'Fairness', description: 'Distribute evenly', enabled: true },
              { name: 'Leader Rotation', description: 'Rotate worship leaders', enabled: true },
            ].map((rule) => (
              <div
                key={rule.name}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 card-glow cursor-default"
              >
                <div>
                  <div className="font-medium text-foreground">{rule.name}</div>
                  <div className="text-sm text-muted-foreground">{rule.description}</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    defaultChecked={rule.enabled}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-secondary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-primary-foreground"></div>
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Instrument Configuration</h3>
          <div className="space-y-2">
            {[
              { name: 'Piano', required: true, members: 'Kass, Chelzy, Zedrick (fallback)' },
              { name: 'Guitar 1', required: true, members: 'Zedrick, Ivan, Pia' },
              { name: 'Guitar 2', required: false, members: 'Kai, Pia' },
              { name: 'Drums', required: true, members: 'Simone' },
              { name: 'Bass', required: true, members: 'Matt, Caleb O., Dhon' },
            ].map((instrument) => (
              <div
                key={instrument.name}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 card-glow cursor-default"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{instrument.name}</span>
                    {instrument.required && (
                      <span className="px-2 py-0.5 rounded text-xs bg-primary/15 text-primary font-medium">
                        Required
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">{instrument.members}</div>
                </div>
                <Button variant="ghost" size="icon">
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
