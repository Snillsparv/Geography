// Minimal PMTiles v3 writer, matching the layout the `pmtiles` JS reader
// parses in bytesToHeader/deserializeIndex:
//
//   [header 127 B][root directory][JSON metadata][leaf directories][tile data]
//
// Constraints honoured:
//   • The reader fetches the first 16384 bytes and slices the root directory
//     out of that buffer, so header + root MUST fit in 16384 bytes. If the
//     (gzipped) root grows past that, entries are split into leaf directories
//     and the root holds one runLength=0 pointer entry per leaf.
//   • Directory entries are sorted by Hilbert tileId, offsets ascending
//     (clustered=1). Entry offset encoding: first entry writes offset+1,
//     contiguous entries write 0, non-contiguous write offset+1.
//
// Tiles are passed in as { z, x, y, data:Buffer } with data already in its
// final encoding (webp ⇒ tileCompression = None).

import { gzipSync } from 'node:zlib';
import { zxyToTileId } from '../node_modules/pmtiles/dist/esm/index.js';

const HEADER_BYTES = 127;
const ROOT_BUDGET = 16384 - HEADER_BYTES;

function writeVarint(num, out) {
  while (num >= 0x80) {
    out.push((num & 0x7f) | 0x80);
    num = Math.floor(num / 128);
  }
  out.push(num);
}

function serializeDirectory(entries) {
  const out = [];
  writeVarint(entries.length, out);
  let last = 0;
  for (const e of entries) { writeVarint(e.tileId - last, out); last = e.tileId; }
  for (const e of entries) writeVarint(e.runLength, out);
  for (const e of entries) writeVarint(e.length, out);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], prev = entries[i - 1];
    if (i > 0 && prev && e.offset === prev.offset + prev.length) writeVarint(0, out);
    else writeVarint(e.offset + 1, out);
  }
  return Buffer.from(out);
}

function setUint64(view, pos, num) {
  view.setUint32(pos + 0, num >>> 0, true);
  view.setUint32(pos + 4, Math.floor(num / 4294967296), true);
}

export function buildPmtiles(tiles, { minZoom, maxZoom, metadata = {}, bounds = [-180, -85, 180, 85], center = [0, 20, 1] }) {
  // Sort by Hilbert tileId and lay tile data out in that order (clustered).
  const withIds = tiles.map(t => ({ tileId: zxyToTileId(t.z, t.x, t.y), data: t.data }))
    .sort((a, b) => a.tileId - b.tileId);

  const entries = [];
  const chunks = [];
  let offset = 0;
  for (const t of withIds) {
    entries.push({ tileId: t.tileId, offset, length: t.data.length, runLength: 1 });
    chunks.push(t.data);
    offset += t.data.length;
  }
  const tileData = Buffer.concat(chunks);

  const metaBuf = gzipSync(Buffer.from(JSON.stringify(metadata)));

  // Root-only if it fits in the first 16 KB, else split into leaves.
  let rootBuf = gzipSync(serializeDirectory(entries));
  let leafBuf = Buffer.alloc(0);
  if (rootBuf.length > ROOT_BUDGET) {
    const CHUNK = 1200;
    const leafChunks = [];
    const rootEntries = [];
    let leafOffset = 0;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK);
      const leaf = gzipSync(serializeDirectory(slice));
      rootEntries.push({ tileId: slice[0].tileId, offset: leafOffset, length: leaf.length, runLength: 0 });
      leafChunks.push(leaf);
      leafOffset += leaf.length;
    }
    leafBuf = Buffer.concat(leafChunks);
    rootBuf = gzipSync(serializeDirectory(rootEntries));
    if (rootBuf.length > ROOT_BUDGET) throw new Error('root directory still too large after leaf split');
  }

  const rootOffset = HEADER_BYTES;
  const metaOffset = rootOffset + rootBuf.length;
  const leafOffset = metaOffset + metaBuf.length;
  const dataOffset = leafOffset + leafBuf.length;

  const header = Buffer.alloc(HEADER_BYTES);
  header.write('PMTiles', 0, 'ascii');
  header[7] = 3;                                   // spec version
  const v = new DataView(header.buffer, header.byteOffset);
  setUint64(v, 8, rootOffset);
  setUint64(v, 16, rootBuf.length);
  setUint64(v, 24, metaOffset);
  setUint64(v, 32, metaBuf.length);
  setUint64(v, 40, leafOffset);
  setUint64(v, 48, leafBuf.length);
  setUint64(v, 56, dataOffset);
  setUint64(v, 64, tileData.length);
  setUint64(v, 72, entries.length);                // numAddressedTiles
  setUint64(v, 80, entries.length);                // numTileEntries
  setUint64(v, 88, entries.length);                // numTileContents (no dedupe)
  header[96] = 1;                                  // clustered
  header[97] = 2;                                  // internalCompression: gzip
  header[98] = 1;                                  // tileCompression: none (webp)
  header[99] = 4;                                  // tileType: webp
  header[100] = minZoom;
  header[101] = maxZoom;
  v.setInt32(102, Math.round(bounds[0] * 1e7), true);
  v.setInt32(106, Math.round(bounds[1] * 1e7), true);
  v.setInt32(110, Math.round(bounds[2] * 1e7), true);
  v.setInt32(114, Math.round(bounds[3] * 1e7), true);
  header[118] = center[2];
  v.setInt32(119, Math.round(center[0] * 1e7), true);
  v.setInt32(123, Math.round(center[1] * 1e7), true);

  return Buffer.concat([header, rootBuf, metaBuf, leafBuf, tileData]);
}
