// Builds raw MIME messages, DKIM-signed with throwaway keys, and an in-memory DNS that
// publishes the matching DKIM, SPF and DMARC records. Lets T3.1 run offline.
import { generateKeyPairSync } from "node:crypto";
import { dkimSign, type DNSResolver } from "mailauth";

const CRLF = "\r\n";

export interface Domain {
  name: string;
  selector: string;
  privateKey: string;
  publicKeyB64: string;
}

export function makeDomain(name: string): Domain {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    name,
    selector: "s1",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

export interface DnsOptions {
  // Sending IPs allowed by SPF
  spfIps?: string[];
  dmarc?: boolean;
}

export function fakeDns(entries: { domain: Domain; options?: DnsOptions }[]): DNSResolver {
  const txt = new Map<string, string[][]>();
  for (const { domain, options = {} } of entries) {
    txt.set(`${domain.selector}._domainkey.${domain.name}`, [[`v=DKIM1; k=rsa; p=${domain.publicKeyB64}`]]);
    const ips = (options.spfIps ?? []).map((ip) => `ip4:${ip}`).join(" ");
    txt.set(domain.name, [[`v=spf1 ${ips} -all`.replace(/\s+/g, " ")]]);
    if (options.dmarc !== false) txt.set(`_dmarc.${domain.name}`, [["v=DMARC1; p=reject"]]);
  }
  return async (name, rrtype) => {
    const records = rrtype === "TXT" ? txt.get(name.toLowerCase()) : undefined;
    if (!records) throw Object.assign(new Error(`no ${rrtype} for ${name}`), { code: "ENOTFOUND" });
    return records;
  };
}

export interface EmailSpec {
  from: string;
  pdfs?: Uint8Array[];
  body?: string;
  messageId?: string;
}

export function composeEmail(spec: EmailSpec): Buffer {
  const boundary = "keel-boundary";
  const parts = [
    `--${boundary}${CRLF}Content-Type: text/plain; charset=utf-8${CRLF}${CRLF}${spec.body ?? "Adjuntamos la factura."}${CRLF}`,
    ...(spec.pdfs ?? []).map(
      (pdf, i) =>
        `--${boundary}${CRLF}Content-Type: application/pdf; name="factura${i}.pdf"${CRLF}` +
        `Content-Disposition: attachment; filename="factura${i}.pdf"${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
        `${Buffer.from(pdf).toString("base64").replace(/.{76}/g, `$&${CRLF}`)}${CRLF}`,
    ),
  ];
  const headers = [
    `From: Facturacion <${spec.from}>`,
    "To: facturas@keel.example",
    "Subject: Factura electronica",
    "Date: Mon, 12 Oct 2026 10:00:00 -0300",
    `Message-ID: <${spec.messageId ?? Math.random().toString(36).slice(2)}@keel.test>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  return Buffer.from(`${headers.join(CRLF)}${CRLF}${CRLF}${parts.join("")}--${boundary}--${CRLF}`);
}

export async function dkimSignatureFor(raw: Buffer, domain: Domain): Promise<string> {
  const { signatures } = await dkimSign(raw, {
    signatureData: [{ signingDomain: domain.name, selector: domain.selector, privateKey: domain.privateKey }],
  });
  return signatures;
}

export async function signEmail(raw: Buffer, domain: Domain): Promise<Buffer> {
  return Buffer.concat([Buffer.from(await dkimSignatureFor(raw, domain)), raw]);
}
