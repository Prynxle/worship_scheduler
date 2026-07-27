'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Calendar, Edit, Eye, MoreVertical, AlertTriangle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ScheduleCardProps {
  id: string;
  date: string;
  week_number: number;
  leader_name: string;
  leader_avatar?: string;
  backup_singers: { name: string; avatar?: string }[];
  instrumentalists: { instrument: string; name: string }[];
  devotion_name?: string;
  status: 'draft' | 'validated' | 'published';
  conflict_count: number;
  onEdit?: () => void;
  onView?: () => void;
  onValidate?: () => void;
  onPublish?: () => void;
}

export function ScheduleCard({
  date,
  week_number,
  leader_name,
  leader_avatar,
  backup_singers,
  instrumentalists,
  devotion_name,
  status,
  conflict_count,
  onEdit,
  onView,
  onValidate,
  onPublish,
}: ScheduleCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published':
        return 'bg-primary/15 text-primary border-primary/20';
      case 'validated':
        return 'bg-accent/15 text-accent border-accent/20';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <Card className="card-glow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <span className="text-xl font-bold text-primary">{week_number}</span>
            </div>
            <div>
              <CardTitle className="text-base text-foreground">Week {week_number}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {new Date(date).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={getStatusColor(status)}>{status}</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onView}>
                  <Eye className="mr-2 h-4 w-4" />
                  View
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onEdit}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                {status === 'draft' && (
                  <DropdownMenuItem onClick={onValidate}>
                    <Calendar className="mr-2 h-4 w-4" />
                    Validate
                  </DropdownMenuItem>
                )}
                {status === 'validated' && (
                  <DropdownMenuItem onClick={onPublish}>
                    <Calendar className="mr-2 h-4 w-4" />
                    Publish
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={leader_avatar} />
              <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                {leader_name.split(' ').map(n => n[0]).join('')}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="text-xs text-muted-foreground">Worship Leader</div>
              <div className="font-medium text-foreground">{leader_name}</div>
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-2">Backup Singers</div>
            <div className="flex flex-wrap gap-1.5">
              {backup_singers.map((singer, index) => (
                <Badge key={index} variant="secondary" className="font-normal">
                  {singer.name}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-2">Instrumentalists</div>
            <div className="flex flex-wrap gap-1.5">
              {instrumentalists.map((inst, index) => (
                <Badge key={index} variant="outline" className="font-normal">
                  {inst.instrument}: {inst.name}
                </Badge>
              ))}
            </div>
          </div>

          {devotion_name && (
            <div>
              <div className="text-xs text-muted-foreground">Devotion</div>
              <div className="font-medium text-foreground">{devotion_name}</div>
            </div>
          )}

          {conflict_count > 0 && (
            <div className="flex items-center gap-2 text-[oklch(0.70_0.08_80)]">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm">{conflict_count} conflict(s) found</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
