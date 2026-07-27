import { DashboardLayout } from '@/components/layout/dashboard-layout';

export default function DashboardLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardLayout title="Worship Scheduler" subtitle="Manage your ministry schedules">
      {children}
    </DashboardLayout>
  );
}
