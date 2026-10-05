'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Music } from 'lucide-react';
import { Ministry, Role } from '@/lib/types/database';
import { isBackupRoleName } from '@/lib/scheduling/role-classifier';
import type { EffectiveBackupRange } from '@/lib/ministries/types';

interface MinistryConfigProps {
  ministry: Ministry;
  roles: Role[];
  effectiveBackupRange: EffectiveBackupRange;
}

export function MinistryConfig({ ministry, roles, effectiveBackupRange }: MinistryConfigProps) {
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
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-foreground">Roles</h3>
          </div>
          {roles.length === 0 ? (
            <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No roles are configured for this ministry.</p>
          ) : <div className="space-y-2">
            {roles.map((role) => {
              const isBackup = isBackupRoleName(role.name);
              const min = isBackup ? effectiveBackupRange.min : role.min_required;
              const max = isBackup ? effectiveBackupRange.max : role.max_allowed;
              return (
              <div
                key={role.id}
                className="flex items-center justify-between rounded-lg border border-border p-3 hover-surface cursor-default"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-medium text-foreground">{role.name}</div>
                    <div className="text-sm text-muted-foreground">
                      Min: {min} | Max: {max}
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>}
        </div>
      </CardContent>
    </Card>
  );
}
