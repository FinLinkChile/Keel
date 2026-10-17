import { File, Paths } from 'expo-file-system';

import { jsonOnboardingStore } from './onboarding';

// On the phone: onboarding.json in the document directory, which the system does not clear
const file = new File(Paths.document, 'onboarding.json');

export const onboardingStore = jsonOnboardingStore({
  read: async () => (file.exists ? file.text() : null),
  write: async (text) => {
    if (!file.exists) file.create();
    file.write(text);
  },
});
