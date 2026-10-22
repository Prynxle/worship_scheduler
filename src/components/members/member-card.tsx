'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Edit, Music } from 'lucide-react';
import { TiltCard } from '@/components/ui/tilt-card';
import { Member } from '@/lib/types/database';

interface MemberCardProps {
  member: Member;
  /**
   * Opens the edit dialog for this member. Required rather than optional: this
   * button is the route into editing, and an optional callback would let a
   * caller render an Edit control that silently does nothing, which is exactly
   * the dead control this replaced.
   */
  onEdit: () => void;
  index?: number;
}

export function MemberCard({ member, onEdit, index = 0 }: MemberCardProps) {
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

  // interactive={false}: this card's header owns the Edit control, and the hover
  // tilt moves the surface out from under the pointer mid-press. A press that
  // starts on the button and ends on the background fires `click` on the card
  // rather than the button, so the dialog never opened -- the button only ever
  // showed its pressed state. The entrance stagger still runs; only the hover
  // transform is dropped.
  return (
    <TiltCard
      tilt={6}
      glare={true}
      interactive={false}
      delay={Math.min(index, 8) * 0.06}
    >
      <Card className="card-glow group/member cursor-default w-full">
        <CardContent className="p-4">
          {/*
            The header has to survive a phone-width card, where the identity
            block and the Edit control compete for the same few hundred pixels.
            Three rules keep them apart:

              - `gap-3` on the row, so the identity block and the Edit button
                never sit flush against each other.
              - `min-w-0` on the identity block. A flex item's automatic minimum
                size is its content width, so without this the card's minimum
                width was the width of the longest word in the longest member
                name plus the nickname, and on a 320px phone the card was
                wider than the screen -- the right-hand edge, Edit button
                included, was cut off.
              - the name and the nickname share one text flow. As two separate
                flex items they competed for the same column: the name was
                squeezed to three lines while the nickname floated beside it at
                mid-height, which reads as overlapping text. As one flow the
                nickname simply wraps with the name.
          */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
              {/* Avatar with gradient ring that intensifies on hover */}
              <div className="relative shrink-0 rounded-full bg-gradient-to-br from-primary via-accent to-[oklch(0.55_0.040_50)] p-[2px] transition-transform duration-200 group-hover/member:scale-105">
                <div className="rounded-full bg-card">
                  <Avatar className="h-14 w-14 rounded-full">
                    <AvatarImage src={member.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold rounded-full">
                      {member.full_name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="break-words font-semibold text-foreground">
                  {member.full_name}
                  {member.nickname && (
                    <span className="ml-1 text-sm font-normal text-muted-foreground">({member.nickname})</span>
                  )}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge className={getStatusColor(member.status)}>
                    {member.status}
                  </Badge>
                  {member.gender && (
                    <span className="text-xs text-muted-foreground capitalize">{member.gender}</span>
                  )}
                </div>
              </div>
            </div>
            {/*
              A labelled button rather than an icon-only or overflow-menu control.
              The menu this replaced held a single action, and the card is dense
              enough that a bare icon asked a coordinator to guess what it did --
              an explicit "Edit" states the action and needs no hover to discover.
            */}
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              aria-label={`Edit ${member.full_name}`}
              // Sits above TiltCard's z-10 glare overlay so the control never
              // shares its hit area with a decorative layer. `shrink-0` keeps
              // the control at its full width: it is the one thing on the row
              // that must not be squeezed, and the identity block is what
              // gives way instead.
              className="relative z-20 shrink-0"
            >
              <Edit className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
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

            {/* Wraps: the assignment count and the last scheduled date must not
                be forced onto one line when the card is narrow. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
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
    </TiltCard>
  );
}