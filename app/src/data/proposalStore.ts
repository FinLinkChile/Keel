import { jsonProposalStore } from './proposals';

// Web build, for development: the proposals sit in this browser's localStorage
function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const proposalStore = jsonProposalStore({
  read: async () => storage()?.getItem('keel.proposals') ?? null,
  write: async (text) => storage()?.setItem('keel.proposals', text),
});
