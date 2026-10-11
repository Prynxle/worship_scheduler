'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AnnouncementAudience, Notification } from '@/lib/types/database';

const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  church: 'Whole church',
  ministry: 'A ministry',
  role: 'An account role',
  members: 'Named members',
};

interface AnnouncementDetailDialogProps {
  announcement: Notification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Centered full-detail view for one announcement, opened from the notification
 * panel. The announcement is kept mounted while the dialog closes so the exit
 * animation does not flash an empty body; the panel clears it on the next open.
 */
export function AnnouncementDetailDialog({ announcement, open, onOpenChange }: AnnouncementDetailDialogProps) {
  const publishedAt = announcement ? new Date(announcement.created_at) : null;
  const timestamp = publishedAt && !Number.isNaN(publishedAt.getTime())
    ? publishedAt.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-8">{announcement?.title}</DialogTitle>
          {timestamp && <DialogDescription>{timestamp}</DialogDescription>}
        </DialogHeader>

        {announcement?.audience_type && (
          <p className="text-xs font-medium text-muted-foreground">
            Sent to: {AUDIENCE_LABELS[announcement.audience_type]}
          </p>
        )}

        <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
          {announcement?.message}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
