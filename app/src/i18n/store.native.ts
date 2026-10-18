import { File, Paths } from 'expo-file-system';

// On the phone: language.txt in the document directory, next to onboarding.json
const file = new File(Paths.document, 'language.txt');

export const languageStore = {
  get: async (): Promise<string | null> => (file.exists ? file.text() : null),
  save: async (code: string): Promise<void> => {
    if (!file.exists) file.create();
    file.write(code);
  },
};
