'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Edit, MoreVertical, Music, Calendar } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Member } from '@/lib/types/database';

interface MemberCardProps {
  member: Member;
  onEdit?: () => void;
  onView?: () => void;
}

export function MemberCard({ member, onEdit, onView }: MemberCardProps) {
  const getStatusColor = (status: string) => {
    return status === 'active' 
      ? 'bg-primary/15 text-primary border-primary/20'
      : 'bg-muted text-muted-foreground border-border';
  };

  const getRoleBadgeColor = (roleName: string) => {
    switch (roleName) {
      case 'Worship Leader':
        return 'bg-[oklch(0.62_0.025_70)]/15 text-[oklch(0.72_0.025_70)] border-[oklch(0.62_0.025_70)]/20';
      case 'Singer':
        return 'bg-accent/15 text-accent border-accent/20';
      case 'Instrumentalist':
        return 'bg-primary/15 text-primary border-primary/20';
      case 'Devotion':
        return 'bg-[oklch(0.60_0.04_80)]/15 text-[oklch(0.70_0.04_80)] border-[oklch(0.60_0.04_80)]/20';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <Card className="card-glow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarImage src={member.avatar_url} />
              <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                {member.full_name.split(' ').map(n => n[0]).join('')}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">{member.full_name}</h3>
                {member.nickname && (
                  <span className="text-sm text-muted-foreground">({member.nickname})</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Badge className={getStatusColor(member.status)}>
                  {member.status}
                </Badge>
                {member.gender && (
                  <span className="text-xs text-muted-foreground capitalize">{member.gender}</span>
                )}
              </div>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onView}>
                <Calendar className="mr-2 h-4 w-4" />
                View Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <div className="text-xs text-muted-foreground mb-2">Roles</div>
            <div className="flex flex-wrap gap-1.5">
              {member.roles?.map((role) => (
                <Badge 
                  key={role.id} 
                  className={getRoleBadgeColor(role.role?.name || '')}
                >
                  {role.role?.name}
                </Badge>
              ))}
            </div>
          </div>

          {member.skills && member.skills.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">Instruments</div>
              <div className="flex flex-wrap gap-1.5">
                {member.skills.map((skill) => (
                  <Badge key={skill.id} variant="outline">
                    <Music className="h-3 w-3 mr-1" />
                    {skill.instrument?.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Assignments: {member.total_assignments}/{member.max_monthly_assignments}
            </span>
            {member.last_scheduled_date && (
              <span className="text-muted-foreground">
                Last: {new Date(member.last_scheduled_date).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
