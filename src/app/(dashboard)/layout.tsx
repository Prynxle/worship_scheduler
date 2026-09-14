import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { SessionGuard } from '@/components/auth/session-guard';

export default function DashboardLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionGuard>
      <DashboardLayout title="Worship Scheduler" subtitle="Manage your ministry schedules">
        {children}
      </DashboardLayout>
    </SessionGuard>
  );
}
