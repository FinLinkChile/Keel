// The documents of PO-0142, the order of act 1 of the demo: what ingest reads from them must be
// what app/src/data/mock.ts says about the order, and the carrier's attestation must be one the
// engine's document rules and the escrow can check.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { recoverTypedDataAddress } from "viem";
import { EIP712_TYPES, keelDomain, type Hex } from "@keel/schemas";
import { blNumberHash, bytes32Text, docsHash } from "@keel/schemas/hash";
import { DEMO_ORDER, demoCarrier, demoDocuments, demoOrderId, demoShipment } from "../testing/demoOrder";
import { parseCommercialInvoiceText, readTradeText } from "./parser";

const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 1000;

describe("PO-0142 demo documents", () => {
  it("reads as the order of the app: agar powder, USD 48,000.00, FOB, HS 1302.31, Hong Kong to San Antonio", async () => {
    const { extractions } = await demoDocuments();
    expect(extractions.invoice).toEqual({
      invoice_number: "LH20260142",
      order_number: "PO0142",
      amount_minor: 4_800_000,
      currency: "USD",
      incoterm: "FOB",
      importer_tax_id: "765432103",
      hs_code: "130231",
      mentions_account_change: false,
      hidden_text_detected: false,
    });
    expect(extractions.transport).toEqual({
      doc_type: "BILL_OF_LADING",
      document_number: "HLIN26100142",
      on_board_date: utc("2026-10-30"),
      port_of_loading: "HKHKG",
      port_of_discharge: "CLSAI",
      hidden_text_detected: false,
    });
    // On board before the deadline of the order
    expect(extractions.transport.on_board_date).toBeLessThanOrEqual(utc(DEMO_ORDER.shipmentDeadline));
  });

  it("prints the account the exporter registered, so the invoice raises no account alert", async () => {
    const { invoicePdf } = await demoDocuments();
    const { destinations } = parseCommercialInvoiceText(await readTradeText(invoicePdf));
    expect(destinations).toContainEqual({ kind: "bank_account", value: "0128440755120142" });
  });

  it("prints Harbor Line as the carrier", async () => {
    const { transportPdf } = await demoDocuments();
    expect((await readTradeText(transportPdf)).all.join("\n")).toContain("HARBOR LINE");
  });

  it("renders the same files every time, so the hashes in documents.json do not drift", async () => {
    const a = await demoDocuments();
    const b = await demoDocuments();
    expect(a.fileHashes).toEqual(b.fileHashes);
  });

  it("is what the files of redteam/corpus/demo are, so they cannot drift", async () => {
    const dir = fileURLToPath(new URL("../../../redteam/corpus/demo/", import.meta.url));
    const read = (name: string) => keccak256(readFileSync(`${dir}${name}`));
    const { fileHashes } = await demoDocuments();
    expect([read("PO-0142-bill-of-lading.pdf"), read("PO-0142-commercial-invoice.pdf")]).toEqual(fileHashes);
  });

  it("derives the order id like the app does (TradeEscrow.open)", () => {
    // PO-0142 of app's demo-data for these two test wallets
    expect(
      demoOrderId("0xF87217E04fDA230B57852ceA541722863E446C15" as Hex, "0xA4cb5c0E5D90C9Bc77C10DcE7a637Ad49C226f42" as Hex),
    ).toBe("0x7a3ec69df8ed206adee0e3aa827b6dc3aeabc96d2b85c9af8e6e6e1353d27c95");
  });

  it("signs the attestation of the package with the demo carrier key for one escrow", async () => {
    const docs = await demoDocuments();
    const orderId = "0x7a3ec69df8ed206adee0e3aa827b6dc3aeabc96d2b85c9af8e6e6e1353d27c95" as Hex;
    const carrier = "0x4d6f8b0d2a3c5e7f9b1d4a6c8e0f2b3d5a7c1e88" as Hex;
    const escrow = "0x00000000000000000000000000000000000000e5" as Hex;
    const { attestation, sigCarrier } = await demoShipment(docs, { orderId, carrier, chainId: 84532, escrow });
    expect(attestation).toEqual({
      orderId,
      blNumberHash: blNumberHash(carrier, "HLIN26100142"),
      onBoardDate: BigInt(utc("2026-10-30")),
      portOfLoading: bytes32Text("HKHKG"),
      docsHash: docsHash(docs.fileHashes),
    });
    const signer = await recoverTypedDataAddress({
      domain: keelDomain(84532, escrow),
      types: { ShipmentAttestation: EIP712_TYPES.ShipmentAttestation },
      primaryType: "ShipmentAttestation",
      message: attestation,
      signature: sigCarrier,
    });
    expect(signer.toLowerCase()).toBe(demoCarrier().address.toLowerCase());
  });
});
