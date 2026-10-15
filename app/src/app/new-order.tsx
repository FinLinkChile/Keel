import { Redirect } from 'expo-router';

import { useSession } from '@/session';
import { Placeholder } from '@/ui/Placeholder';

// 03 New order, not built yet. Opened by the raised button of the tab bar. Only the
// importer opens orders.
export default function NewOrder() {
  const { role } = useSession();
  if (role !== 'importer') return <Redirect href="/home" />;
  return <Placeholder title="New order" back />;
}
