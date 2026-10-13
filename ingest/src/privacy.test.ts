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

  it("uses a fresh salt each time, so tokens cannot be linked or brute-forced", () => {
    const a = redactForLlm("R.U.T.: 76.123.456-0").text;
    const b = redactForLlm("R.U.T.: 76.123.456-0").text;
    expect(a).not.toBe(b);
  });
});

describe("logTransfer", () => {
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
