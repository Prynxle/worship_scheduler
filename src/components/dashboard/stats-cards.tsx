'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TiltCard } from '@/components/ui/tilt-card';
import { Users, Calendar, AlertTriangle, CheckCircle } from 'lucide-react';

interface StatsCardsProps {
  totalMembers: number;
  upcomingServices: number;
  pendingConflicts: number;
  completedSchedules: number;
}

export function StatsCards({ 
  totalMembers, 
  upcomingServices, 
  pendingConflicts, 
  completedSchedules 
}: StatsCardsProps) {
  const stats = [
    {
      title: 'Total Members',
      value: totalMembers,
      icon: Users,
      description: 'Active ministry members',
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'Upcoming Services',
      value: upcomingServices,
      icon: Calendar,
      description: 'This month',
      color: 'text-accent',
      bgColor: 'bg-accent/10',
    },
    {
      title: 'Pending Conflicts',
      value: pendingConflicts,
      icon: AlertTriangle,
      description: 'Need attention',
      color: 'text-[oklch(0.70_0.08_80)]',
      bgColor: 'bg-[oklch(0.70_0.08_80)]/10',
    },
    {
      title: 'Completed',
      value: completedSchedules,
      icon: CheckCircle,
      description: 'Schedules published',
      color: 'text-[oklch(0.68_0.06_145)]',
      bgColor: 'bg-[oklch(0.68_0.06_145)]/10',
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat, index) => (
        <TiltCard
          key={stat.title}
          tilt={5}
          glare={true}
          delay={index * 0.08}
        >
          <Card className="card-glow cursor-default w-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <div className={`icon-chip ${stat.bgColor}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.description}</p>
            </CardContent>
          </Card>
        </TiltCard>
      ))}
    </div>
  );
}