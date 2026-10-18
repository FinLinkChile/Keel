// Web build, for development: the chosen language sits in this browser's localStorage
function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const languageStore = {
  get: async (): Promise<string | null> => storage()?.getItem('keel.language') ?? null,
  save: async (code: string): Promise<void> => storage()?.setItem('keel.language', code),
};
