import { Redirect } from 'expo-router';
import { View } from 'react-native';

import { useSession } from '@/session';
import { colors } from '@/ui/theme';

// A phone that has not signed up starts at the sign-up; one that has starts at Connect.
export default function Index() {
  const { onboarding } = useSession();
  if (onboarding === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return <Redirect href={onboarding ? '/connect' : '/onboarding'} />;
}
