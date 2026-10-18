import { File, Paths } from 'expo-file-system';

import { jsonProposalStore } from './proposals';

// On the phone: proposals.json in the document directory, which the system does not clear
const file = new File(Paths.document, 'proposals.json');

export const proposalStore = jsonProposalStore({
  read: async () => (file.exists ? file.text() : null),
  write: async (text) => {
    if (!file.exists) file.create();
    file.write(text);
  },
});
