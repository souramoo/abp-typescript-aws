import type { MailMessage } from "@abp/emailing";

const CRLF = "\r\n";

/** RFC 2047 encoded-word for header values with non-ASCII characters. */
export function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function formatAddress(address: string, displayName: string | undefined): string {
  if (!displayName) return address;
  const name = encodeHeaderWord(displayName);
  return name === displayName ? `"${displayName.replace(/["\\]/g, "\\$&")}" <${address}>` : `${name} <${address}>`;
}

function base64Lines(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/(.{76})/g, `$1${CRLF}`);
}

function quoteParameter(value: string): string {
  return `"${value.replace(/["\\\r\n]/g, "_")}"`;
}

/**
 * Builds a `multipart/mixed` RFC 5322 message (body part + attachments) for SES raw sending. Recipients are passed
 * to SES separately, so `Bcc` is intentionally not written into the headers.
 */
export function buildMimeMessage(mail: MailMessage, boundary = `----=_Part_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`): string {
  const headers: string[] = [];
  if (mail.from) headers.push(`From: ${formatAddress(mail.from.address, mail.from.displayName)}`);
  headers.push(`To: ${mail.to.join(", ")}`);
  if (mail.cc.length > 0) headers.push(`Cc: ${mail.cc.join(", ")}`);
  headers.push(`Subject: ${encodeHeaderWord(mail.subject ?? "")}`);
  for (const [name, value] of mail.headers) headers.push(`${name}: ${encodeHeaderWord(value)}`);
  headers.push("MIME-Version: 1.0");
  headers.push(`Content-Type: multipart/mixed; boundary=${quoteParameter(boundary)}`);

  const parts: string[] = [];
  parts.push([`Content-Type: ${mail.isBodyHtml ? "text/html" : "text/plain"}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", base64Lines(Buffer.from(mail.body ?? "", "utf8"))].join(CRLF));
  for (const attachment of mail.attachments) {
    const name = quoteParameter(attachment.name);
    parts.push([`Content-Type: ${attachment.contentType ?? "application/octet-stream"}; name=${name}`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename=${name}`, "", base64Lines(attachment.file)].join(CRLF));
  }

  return [headers.join(CRLF), "", ...parts.map((p) => `--${boundary}${CRLF}${p}`), `--${boundary}--`, ""].join(CRLF);
}
