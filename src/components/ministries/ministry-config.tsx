'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Music, Plus, Settings, Trash2 } from 'lucide-react';
import { Ministry, Role } from '@/lib/types/database';

interface MinistryConfigProps {
  ministry: Ministry;
  roles: Role[];
  onAddRole?: () => void;
  onEditRole?: (role: Role) => void;
  onDeleteRole?: (role: Role) => void;
  onUpdateConfig?: (config: Partial<Ministry['config']>) => void;
}

export function MinistryConfig({
  ministry,
  roles,
  onAddRole,
  onEditRole,
  onDeleteRole,
  onUpdateConfig,
}: MinistryConfigProps) {
  return (
    <Card className="card-glow">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Music className="h-5 w-5 text-primary" />
            {ministry.name}
          </CardTitle>
          <Badge variant={ministry.is_active ? 'default' : 'secondary'}>
            {ministry.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="min-members">Minimum Members</Label>
            <Input
              id="min-members"
              type="number"
              value={ministry.config.min_members}
              onChange={(e) =>
                onUpdateConfig?.({ min_members: parseInt(e.target.value) || 0 })
              }
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="max-members">Maximum Members</Label>
            <Input
              id="max-members"
              type="number"
              value={ministry.config.max_members}
              onChange={(e) =>
                onUpdateConfig?.({ max_members: parseInt(e.target.value) || 0 })
              }
              className="mt-1.5"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ministry.config.requires_leader}
              onChange={(e) =>
                onUpdateConfig?.({ requires_leader: e.target.checked })
              }
              className="rounded border-border bg-transparent"
            />
            <span className="text-sm text-foreground">Requires Leader</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ministry.config.allows_dual_role}
              onChange={(e) =>
                onUpdateConfig?.({ allows_dual_role: e.target.checked })
              }
              className="rounded border-border bg-transparent"
            />
            <span className="text-sm text-foreground">Allows Dual Role</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ministry.config.auto_generate}
              onChange={(e) =>
                onUpdateConfig?.({ auto_generate: e.target.checked })
              }
              className="rounded border-border bg-transparent"
            />
            <span className="text-sm text-foreground">Auto Generate</span>
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-foreground">Roles</h3>
            <Button size="sm" onClick={onAddRole}>
              <Plus className="h-4 w-4 mr-1" />
              Add Role
            </Button>
          </div>
          <div className="space-y-2">
            {roles.map((role) => (
              <div
                key={role.id}
                className="flex items-center justify-between rounded-lg border border-border p-3 hover-surface cursor-default"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-medium text-foreground">{role.name}</div>
                    <div className="text-sm text-muted-foreground">
                      Min: {role.min_required} | Max: {role.max_allowed}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEditRole?.(role)}
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDeleteRole?.(role)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
