import { AnnouncementComposer } from '@/components/notifications/announcement-composer';

export default function AnnouncementsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Announcements</h2>
        <p className="text-muted-foreground">Publish updates to members of your church</p>
      </div>

      <AnnouncementComposer />
    </div>
  );
}
