// Where the private key of the test wallet is kept on this device.
export interface KeyStore {
  // Shown in development screens, so it is clear which storage was used
  where: 'secure-store' | 'browser-storage';
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  // Development only: forgets the key for good
  remove(): Promise<void>;
}
