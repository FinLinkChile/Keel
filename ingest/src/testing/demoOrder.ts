// The documents of PO-0142, the order of act 1 of the demo (happy path). The values are the ones
// of app/src/data/mock.ts, which Area 4 owns: Lingnan Hydrocolloids sells 6,000 kg of agar
// powder to Pacífico Foods SpA for USD 48,000.00, FOB Hong Kong, with Harbor Line as the carrier
// and a shipment deadline of 2026-11-20. Fictitious companies and accounts.
//
// What it produces is what each side of the demo would hand over: the two PDFs the exporter
// uploads, what ingest reads from them (the agent's documents.json) and the carrier's signed
// attestation over that package (the agent's shipment.json). The payout address is nowhere in
// here: it comes from the signed order.
import { encodeAbiParameters, keccak256, type Hex as ViemHex } from "viem";
import { EIP712_TYPES, keelDomain, type CommercialInvoiceExtraction, type Hex, type ShipmentAttestation, type TransportDocumentExtraction } from "@keel/schemas";
import { blNumberHash, bytes32Text, docsHash } from "@keel/schemas/hash";
import { parseCommercialInvoiceText, parseTransportText, readTradeText } from "../trade/parser";
import { fileHash } from "../trade/upload";
import { renderCommercialInvoice, renderTransport, type CommercialInvoiceSpec, type TransportSpec } from "./renderTrade";
import { testAccount } from "./tradeCorpus";

export const DEMO_ORDER = {
  label: "PO-0142",
  // The order label is the nonce in hex (app/src/data/mock.ts)
  nonce: 0x142n,
  shipmentDeadline: "2026-11-20",
} as const;

// Harbor Line's key in the demo. The order names its address as carrier, so the address of the
// "harbor-line" party in app/src/data/mock.ts has to be this one for its signature to count.
export const demoCarrier = () => testAccount("demo:carrier:harbor-line");

// TradeEscrow.open: orderId = keccak256(abi.encode(importer, exporter, nonce))
export function demoOrderId(importer: Hex, exporter: Hex, nonce: bigint = DEMO_ORDER.nonce): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [importer as ViemHex, exporter as ViemHex, nonce]),
  );
}

// Shipped after the deposit of act 1 and before the deadline
const ON_BOARD = ["30-OCT-2026", "2026-10-30"] as const;

export const DEMO_TRANSPORT: TransportSpec = {
  kind: "BILL_OF_LADING",
  layout: "oceanlink",
  company: "HARBOR LINE",
  number: "HLIN-2610-0142",
  onBoardDate: ON_BOARD[0],
  portOfLoading: "HONG KONG",
  portOfDischarge: "SAN ANTONIO, CHILE",
  shipper: "LINGNAN HYDROCOLLOIDS LTD.",
  consignee: "PACIFICO FOODS SPA",
  goods: "240 BAGS AGAR POWDER, FOOD GRADE (6000 KG)",
  vessel: "HARBOR PIONEER 043E",
};

export const DEMO_INVOICE: CommercialInvoiceSpec = {
  seller: "LINGNAN HYDROCOLLOIDS LTD.",
  buyer: "PACIFICO FOODS SPA",
  buyerRut: "76.543.210-3",
  invoiceNumber: "LH-2026-0142",
  orderNumber: "PO-0142",
  date: ON_BOARD[1],
  terms: "FOB HONG KONG",
  currency: "USD",
  items: [{ description: "AGAR POWDER, FOOD GRADE", hs: "1302.31", qty: 6000, unit: "KG", unitPrice: "8.00", amount: "48,000.00" }],
  // The account the exporter registered, as the invoice prints it
  bankLines: ["Beneficiary Bank: BANK OF LINGNAN", "A/C No.: 0128 4407 5512 0142"],
};

export interface DemoDocuments {
  transportPdf: Uint8Array;
  invoicePdf: Uint8Array;
  // What ingest reads when both readers agree: the agent's documents.json
  extractions: { transport: TransportDocumentExtraction; invoice: CommercialInvoiceExtraction };
  // transport document first, then the invoice
  fileHashes: [Hex, Hex];
}

export async function demoDocuments(): Promise<DemoDocuments> {
  const transportPdf = await renderTransport(DEMO_TRANSPORT);
  const invoicePdf = await renderCommercialInvoice(DEMO_INVOICE);
  const transport = parseTransportText(await readTradeText(transportPdf)).extraction;
  const invoice = parseCommercialInvoiceText(await readTradeText(invoicePdf)).extraction;
  return {
    transportPdf,
    invoicePdf,
    extractions: { transport, invoice },
    fileHashes: [fileHash(transportPdf), fileHash(invoicePdf)],
  };
}

// The carrier's attestation of the package, signed with the demo carrier key. `carrier` is the
// address the order names, which is part of blNumberHash; `escrow` is the contract that checks it.
export async function demoShipment(
  docs: DemoDocuments,
  opts: { orderId: Hex; carrier: Hex; chainId: number; escrow: Hex },
): Promise<{ attestation: ShipmentAttestation; sigCarrier: Hex }> {
  const attestation: ShipmentAttestation = {
    orderId: opts.orderId,
    blNumberHash: blNumberHash(opts.carrier, docs.extractions.transport.document_number),
    onBoardDate: BigInt(docs.extractions.transport.on_board_date),
    portOfLoading: bytes32Text(docs.extractions.transport.port_of_loading),
    docsHash: docsHash(docs.fileHashes),
  };
  const sigCarrier = await demoCarrier().signTypedData({
    domain: keelDomain(opts.chainId, opts.escrow),
    types: { ShipmentAttestation: EIP712_TYPES.ShipmentAttestation },
    primaryType: "ShipmentAttestation",
    message: attestation,
  });
  return { attestation, sigCarrier };
}
