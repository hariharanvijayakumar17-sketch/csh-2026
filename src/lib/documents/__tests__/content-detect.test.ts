import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { contentDisposition, detectContent, MIME } from "../content-detect";

/**
 * F3 content detection (unit). zip fixtures are built here with STORE method
 * (no compression) so no zip library is needed: local headers + central
 * directory + EOCD, exactly what a real tool emits.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameB = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (arbitrary fixed)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(Buffer.concat([local, nameB, data]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameB.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameB]));
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const DOCX = buildZip({
  "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
  "word/document.xml": `<?xml version="1.0"?><w:document/>`,
  "word/_rels/document.xml.rels": `<Relationships/>`,
});

const PPTX = buildZip({
  "[Content_Types].xml": `<?xml version="1.0"?><Types/>`,
  "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation/>`,
});

describe("F3: detectContent — the bytes decide, never file.type", () => {
  it("detects pdf by magic bytes", () => {
    expect(detectContent(Buffer.from("%PDF-1.4 hello"))).toEqual({ kind: "pdf", mime: MIME.pdf });
  });

  it("rejects a file DECLARED as docx but actually html (probe C payload)", () => {
    const fake = Buffer.from("<html><script>alert(1)</script>");
    expect(detectContent(fake).kind).toBe("unknown");
  });

  it("classifies a real OOXML docx via the zip central directory", () => {
    expect(detectContent(DOCX)).toEqual({ kind: "docx", mime: MIME.docx });
  });

  it("classifies a real OOXML pptx", () => {
    expect(detectContent(PPTX)).toEqual({ kind: "pptx", mime: MIME.pptx });
  });

  it("a plain zip (no OOXML parts) is application/zip", () => {
    const z = buildZip({ "readme.txt": "hi" });
    expect(detectContent(z)).toEqual({ kind: "zip", mime: MIME.zip });
  });

  it("a PK header with no parsable central directory is corrupt_zip (rejected)", () => {
    expect(detectContent(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02])).kind).toBe("corrupt_zip");
  });

  it("mp4 / jpeg / png by signature", () => {
    const mp4 = Buffer.alloc(12, 0);
    mp4.write("ftyp", 4, "latin1");
    expect(detectContent(mp4).mime).toBe(MIME.mp4);
    expect(detectContent(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])).mime).toBe(MIME.jpeg);
    expect(detectContent(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2])).mime).toBe(MIME.png);
  });

  it("tiny / unrecognised buffers are unknown", () => {
    expect(detectContent(Buffer.from("ab")).kind).toBe("unknown");
    expect(detectContent(Buffer.from([1, 2, 3, 4, 5])).kind).toBe("unknown");
  });
});

describe("F3: contentDisposition — RFC 5987", () => {
  it("keeps a plain ASCII name in both parameters", () => {
    expect(contentDisposition("letter.pdf")).toBe(
      'attachment; filename="letter.pdf"; filename*=UTF-8\'\'letter.pdf'
    );
  });

  it("percent-encodes a UTF-8 name and provides an ASCII fallback", () => {
    const header = contentDisposition("अनुमति पत्र v2.pdf");
    expect(header).toContain("filename*=UTF-8''%E0%A4%85"); // 'अ' = U+0905
    const fallback = header.match(/filename="([^"]*)"/)?.[1] ?? "";
    expect(fallback.replace(/[\x20-\x7e]/g, "")).toBe(""); // fallback is ASCII-only
    expect(fallback).not.toBe("");
  });

  it("neutralises quote/backslash/semicolon in the ASCII fallback", () => {
    const header = contentDisposition('we"ird;name\\x.pdf');
    const fallback = header.match(/filename="([^"]*)"/)?.[1] ?? "";
    expect(fallback).not.toMatch(/["\\;]/);
  });
});
