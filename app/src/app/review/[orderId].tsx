import type { Hex } from '@keel/schemas';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { ImporterReview } from '@/orders/ImporterReview';
import { useSession } from '@/session';

// Review before you sign: the importer's last signature on an order proposed on this phone.
// Opened from the step that needs the importer in 05 Order in progress.
export default function Review() {
  const { orderId } = useLocalSearchParams<{ orderId: Hex }>();
  const { role } = useSession();
  if (role !== 'importer') return <Redirect href="/home" />;
  return <ImporterReview orderId={orderId} />;
}
