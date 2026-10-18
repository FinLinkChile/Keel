// Web build, for development: the chosen theme sits in this browser's localStorage
function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const themeStore = {
  get: async (): Promise<string | null> => storage()?.getItem('keel.theme') ?? null,
  save: async (mode: string): Promise<void> => storage()?.setItem('keel.theme', mode),
};
