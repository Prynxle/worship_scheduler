'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Calendar, Clock } from 'lucide-react';

interface UpcomingService {
  id: string;
  date: string;
  week_number: number;
  leader_name: string;
  leader_avatar?: string;
  backup_count: number;
  status: 'draft' | 'validated' | 'published';
}

interface UpcomingServicesProps {
  services: UpcomingService[];
}

export function UpcomingServices({ services }: UpcomingServicesProps) {
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          Upcoming Services
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {services.map((service) => (
            <div
              key={service.id}
              className="flex items-center justify-between py-3.5 border-b border-border last:border-0 hover-surface -mx-6 px-6 cursor-default"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <span className="text-xl font-bold text-primary">{service.week_number}</span>
                </div>
                <div>
                  <div className="font-medium text-foreground">{service.leader_name}</div>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(service.date).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {Array.from({ length: Math.min(service.backup_count, 3) }).map((_, i) => (
                    <Avatar key={i} className="h-8 w-8 border-2 border-background">
                      <AvatarFallback className="text-xs bg-secondary text-muted-foreground">
                        {i + 1}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {service.backup_count > 3 && (
                    <Avatar className="h-8 w-8 border-2 border-background">
                      <AvatarFallback className="text-xs bg-secondary text-muted-foreground">
                        +{service.backup_count - 3}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
                <Badge className={getStatusColor(service.status)}>
                  {service.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
