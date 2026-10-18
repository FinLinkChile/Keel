// Where the private keys of the test wallets are kept on this device. Each key has a name.
export interface KeyStore {
  // Shown in development screens, so it is clear which storage was used
  where: 'secure-store' | 'browser-storage';
  read(name: string): Promise<string | null>;
  write(name: string, value: string): Promise<void>;
  // Development only: forgets the key for good
  remove(name: string): Promise<void>;
}
