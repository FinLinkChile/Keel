import { describe, expect, it } from "vitest";
import { logTransfer, redactForLlm, rehydrate, transferLog } from "./privacy";

describe("redactForLlm", () => {
  const text = [
    "R.U.T.: 76.123.456-0",
    "Senor(es): IMPORTADORA LOS ANDES SPA",
    "Direccion: Av. Siempre Viva 742",
    "Banco Estado Cuenta Corriente N° 123456789",
    "Pagar a 0x1111111111111111111111111111111111111111",
    "Fono +56 9 8765 4321 correo pagos@empresa.cl",
    "TOTAL $ 45.990",
  ].join("\n");

  it("masks every category and leaves amounts alone", () => {
    const { text: out, found } = redactForLlm(text);
    expect(Object.keys(found).sort()).toEqual(["cuenta", "direccion", "email", "nombre", "rut", "telefono", "wallet"]);
    expect(out).toContain("TOTAL $ 45.990");
    expect(out).toMatch(/Senor\(es\): \[NOMBRE_[0-9a-f]{8}\]/);
    expect(out).toMatch(/Cuenta Corriente N° \[CUENTA_[0-9a-f]{8}\]/);
  });

  it("round-trips through rehydrate", () => {
    const { text: out, tokenMap } = redactForLlm(text);
    expect(rehydrate(out, tokenMap)).toBe(text);
  });

  it("masks the parties and bank details of trade documents, and keeps what the extractor must read", () => {
    const trade = [
      "SHIPPER: NINGBO BRIGHT TOOLS CO., LTD.",
      "Consignee: IMPORTADORA LOS ANDES SPA",
      "Buyer: IMPORTADORA LOS ANDES SPA",
      "A/C No.: 6228 4801 2233 4455",
      "IBAN: DE89 3704 0044 0532 0130 00",
      "B/L No.: OLSU-2610-4471",
      "Port of Loading: NINGBO, CHINA",
      "TOTAL AMOUNT: USD 20,000.00",
    ].join("\n");
    const { text: out, found } = redactForLlm(trade);
    expect(Object.keys(found).sort()).toEqual(["cuenta", "iban", "nombre"]);
    // Whole values: a random token can contain a short digit run such as "6228" by chance
    expect(out).not.toMatch(/NINGBO BRIGHT|LOS ANDES|6228 4801 2233 4455|DE89 3704/);
    for (const kept of ["B/L No.: OLSU-2610-4471", "Port of Loading: NINGBO, CHINA", "TOTAL AMOUNT: USD 20,000.00"]) {
      expect(out).toContain(kept);
    }
  });

  it("uses a fresh salt each time, so tokens cannot be linked or brute-forced", () => {
    const a = redactForLlm("R.U.T.: 76.123.456-0").text;
    const b = redactForLlm("R.U.T.: 76.123.456-0").text;
    expect(a).not.toBe(b);
  });
});

describe("logTransfer", () => {
  it("records trade documents under their own purpose", () => {
    logTransfer("anthropic", ["nombre"], "extraccion_documento_comercio");
    expect(transferLog().at(-1)).toMatchObject({ finalidad: "extraccion_documento_comercio", terceroDeclarado: true });
  });

  it("records the transfer to the LLM vendor as declared", () => {
    logTransfer("anthropic", ["rut", "nombre"]);
    expect(transferLog().at(-1)).toMatchObject({
      destino: "anthropic",
      finalidad: "extraccion_factura",
      categorias: ["rut", "nombre"],
      terceroDeclarado: true,
    });
  });
});
