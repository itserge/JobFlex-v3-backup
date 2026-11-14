// ROOF FACETS — A PNG WRITER (2026-11-11) AND READER (2026-11-13). The lab's pictures (the aerial crop, the shaded height map) are a few
// hundred pixels a side; writing them needs a deflate and two checksums, not an image library. SERVER-ONLY (node:zlib).

import { deflateSync, inflateSync } from "node:zlib";

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}

/** An 8-bit RGB picture (three bytes a pixel, row-major) as PNG bytes. */
export function encodePng(rgb: Uint8Array, width: number, height: number): Buffer {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8; // bit depth
  head[9] = 2; // truecolour
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // no filter
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * stride + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

/**
 * A PNG as its pixels (2026-11-13: EagleView's aerial picture arrives as one, and the lab reads it to lay it on the
 * height map's grid). Only what such pictures are: 8 bits a channel, truecolour with or without alpha, not interlaced.
 * Returns RGB, three bytes a pixel; throws on anything else.
 */
export function decodePng(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error("not a PNG");
  let at = 8, width = 0, height = 0, channels = 0;
  const idat: Buffer[] = [];
  while (at + 8 <= b.length) {
    const len = b.readUInt32BE(at), type = b.toString("latin1", at + 4, at + 8), body = b.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      const depth = body[8], colour = body[9], interlace = body[12];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) throw new Error(`a PNG this reader does not read (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
      channels = colour === 2 ? 3 : 4;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  if (!width || !height || !channels || !idat.length || width * height > 40_000_000) throw new Error("a PNG with no picture in it");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("a PNG cut short");
  const line = new Uint8Array(stride), prev = new Uint8Array(stride);
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0, up = prev[i], c = i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) { const o = (y * width + x) * 3, i = x * channels; out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; }
    prev.set(line);
  }
  return { width, height, data: out };
}
