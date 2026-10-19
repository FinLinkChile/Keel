import { File, Paths } from 'expo-file-system';

// On the phone: theme.txt in the document directory, next to language.txt
const file = new File(Paths.document, 'theme.txt');

export const themeStore = {
  get: async (): Promise<string | null> => (file.exists ? file.text() : null),
  save: async (mode: string): Promise<void> => {
    if (!file.exists) file.create();
    file.write(mode);
  },
};
