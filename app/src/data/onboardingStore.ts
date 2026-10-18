import { jsonOnboardingStore } from './onboarding';

// Web build, for development: the sign-up sits in this browser's localStorage
function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const onboardingStore = jsonOnboardingStore({
  read: async () => storage()?.getItem('keel.onboarding') ?? null,
  write: async (text) => storage()?.setItem('keel.onboarding', text),
});
