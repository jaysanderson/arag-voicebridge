/** Minimal multipart/form-data parser (RFC 7578) for uploads — no streaming, bounded by the body limit. */
import type { UploadedFile } from "./app.ts";
import { badRequest } from "./problem.ts";

export interface MultipartResult {
  fields: Record<string, string>;
  files: UploadedFile[];
}

export function parseMultipart(body: Buffer, contentType: string): MultipartResult {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (m?.[1] ?? m?.[2] ?? "").trim();
  if (!boundary) throw badRequest("multipart/form-data without boundary");
  const delim = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];
  let pos = body.indexOf(delim);
  while (pos !== -1) {
    pos += delim.length;
    if (body.slice(pos, pos + 2).toString() === "--") break; // closing delimiter
    if (body.slice(pos, pos + 2).toString() === "\r\n") pos += 2;
    const headerEnd = body.indexOf("\r\n\r\n", pos);
    if (headerEnd === -1) break;
    const headers = body.slice(pos, headerEnd).toString("utf8");
    const next = body.indexOf(delim, headerEnd + 4);
    const dataEnd = next === -1 ? body.length : next - 2; // strip CRLF before delimiter
    const data = body.slice(headerEnd + 4, Math.max(headerEnd + 4, dataEnd));
    const disp = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headers)?.[1] ?? "";
    const name = /name="([^"]*)"/i.exec(disp)?.[1] ?? "";
    const filename = /filename="([^"]*)"/i.exec(disp)?.[1];
    const ct = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "application/octet-stream";
    if (filename !== undefined) {
      let decoded = filename;
      try {
        decoded = decodeURIComponent(filename);
      } catch {
        /* keep the raw filename when it is not percent-encoded */
      }
      files.push({ field: name, filename: decoded.replace(/[\\/]+/g, "_"), contentType: ct, data });
    } else fields[name] = data.toString("utf8");
    pos = next;
  }
  return { fields, files };
}
