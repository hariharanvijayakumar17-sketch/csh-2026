/**
 * F3: SERVER-SIDE content detection. The client-declared MIME (file.type)
 * is NEVER trusted for validation — the bytes decide what the file is.
 * Office "OOXML" formats are zip containers: we parse the central directory
 * (minimal, bounded, allocation-light) and classify by the parts present:
 *   [Content_Types].xml + word/  -> docx
 *   [Content_Types].xml + ppt/   -> pptx
 *   otherwise a valid zip         -> application/zip
 * A PK header with no parsable central directory is REJECTED (corrupt/fake).
 *
 * Pure module (no imports) so it is unit-testable without the DB layer.
 */

export const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  mp4: "video/mp4",
  jpeg: "image/jpeg",
  png: "image/png",
} as const;

export type DetectedKind =
  | "pdf"
  | "docx"
  | "pptx"
  | "zip"
  | "corrupt_zip"
  | "mp4"
  | "jpeg"
  | "png"
  | "unknown";

export interface DetectedContent {
  kind: DetectedKind;
  /** The MIME the SERVER detected (stored as mimeDetected). null if unknown. */
  mime: string | null;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

/** Find the End-Of-Central-Directory record (scan back up to 64 KiB of comment). */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let off = buf.length - 22; off >= min; off--) {
    if (buf.length - off >= 4 && buf.readUInt32LE(off) === EOCD_SIG) return off;
  }
  return -1;
}

/** Extract entry names from the central directory. Returns null if unparseable. */
function zipEntryNames(buf: Buffer): string[] | null {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset + 4 > buf.length) return null;
  const names: string[] = [];
  let pos = cdOffset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL_SIG) return null;
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    if (pos + 46 + nameLen > buf.length) return null;
    names.push(buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8"));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function classifyZip(buf: Buffer): DetectedContent {
  const names = zipEntryNames(buf);
  if (names === null) return { kind: "corrupt_zip", mime: null };
  const hasContentTypes = names.some((n) => n === "[Content_Types].xml");
  const hasWord = names.some((n) => n === "word/" || n.startsWith("word/"));
  const hasPpt = names.some((n) => n === "ppt/" || n.startsWith("ppt/"));
  if (hasContentTypes && hasWord) return { kind: "docx", mime: MIME.docx };
  if (hasContentTypes && hasPpt) return { kind: "pptx", mime: MIME.pptx };
  return { kind: "zip", mime: MIME.zip };
}

/** Detect what a buffer actually is. Never throws. */
export function detectContent(buf: Buffer): DetectedContent {
  if (buf.length < 4) return { kind: "unknown", mime: null };
  if (buf.subarray(0, 4).equals(Buffer.from("%PDF"))) return { kind: "pdf", mime: MIME.pdf };
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    // zip family (docx/pptx/zip all start PK)
    return classifyZip(buf);
  }
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") return { kind: "mp4", mime: MIME.mp4 };
  if (buf[0] === 0xff && buf[1] === 0xd8) return { kind: "jpeg", mime: MIME.jpeg };
  if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return { kind: "png", mime: MIME.png };
  return { kind: "unknown", mime: null };
}

/**
 * F3: RFC 5987 content-disposition for downloads.
 * ASCII-safe filename in the plain `filename` parameter (fallback for old
 * clients) + `filename*=UTF-8''<percent-encoded>` for everything else.
 */
export function contentDisposition(originalFilename: string): string {
  const asciiFallback = (originalFilename.match(/[\x20-\x7e]/g) ?? []).join("");
  const safeAscii = (asciiFallback || "download").replace(/["\\;]/g, "_");
  const encoded = encodeURIComponent(originalFilename);
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}
