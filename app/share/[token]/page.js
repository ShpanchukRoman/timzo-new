import ScheduleShell from '@/components/ScheduleShell';

export default function SharePage({ params }) {
  return <ScheduleShell shareToken={params.token} />;
}
