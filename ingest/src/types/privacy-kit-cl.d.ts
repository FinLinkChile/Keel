// Minimal types for the parts of privacy-kit-cl (CommonJS, untyped) that ingest uses.
declare module "privacy-kit-cl" {
  export interface RedactionResult {
    text: string;
    tokenMap: Record<string, string>;
    found: Record<string, number>;
  }

  export interface Store {
    find(collection: string, query: Record<string, unknown>): Record<string, unknown>[];
  }

  export class PrivacyKit {
    static fromObject(config: Record<string, unknown>): PrivacyKit;
    readonly store: Store;
    readonly redaction: {
      redact(text: string, subjectId?: string): RedactionResult;
      rehydrate(text: string, tokenMap: Record<string, string>): string;
    };
    readonly transfers: {
      log(subjectId: string, destino: string, finalidad: string, categorias?: string[]): void;
    };
  }
}
