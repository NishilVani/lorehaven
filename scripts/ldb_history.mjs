/* Every version of a localStorage value still physically present in a
   LevelDB directory: live ones, and superseded ones that compaction has not yet
   dropped. Reads .ldb tables (block format) and .log write-ahead files. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const snappy = createRequire(import.meta.url)('snappyjs');

const dir = process.argv[2];
const wantKey = process.argv[3] || 'moctale_library';
const found = [];   // { file, origin, value }

const varint = (buf, pos) => { let r = 0, s = 0, b; do { b = buf[pos++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return [r, pos]; };
const readBlock = (buf, off, size) => {
  const type = buf[off + size];
  const raw = buf.subarray(off, off + size);
  return type === 1 ? Buffer.from(snappy.uncompress(raw)) : raw;
};
const blockEntries = (block) => {
  const n = block.readUInt32LE(block.length - 4);
  const end = block.length - 4 - n * 4;
  const out = []; let pos = 0, lastKey = Buffer.alloc(0);
  while (pos < end) {
    let shared, nonShared, vlen;
    [shared, pos] = varint(block, pos); [nonShared, pos] = varint(block, pos); [vlen, pos] = varint(block, pos);
    const key = Buffer.concat([lastKey.subarray(0, shared), block.subarray(pos, pos + nonShared)]); pos += nonShared;
    const value = block.subarray(pos, pos + vlen); pos += vlen;
    out.push([key, value]); lastKey = key;
  }
  return out;
};
const consider = (file, ikey, value) => {
  const ks = ikey.toString('latin1');
  if (!ks.startsWith('_')) return;
  const sep = ks.indexOf('\u0000\u0001'); if (sep < 0) return;
  const key = ks.slice(sep + 2).replace(/[\s\S]{8}$/, '');  // strip 8-byte seq/type trailer on internal keys
  if (key !== wantKey && ks.slice(sep + 2) !== wantKey) return;
  if (!value.length) return;
  const val = value[0] === 0 ? Buffer.from(value.subarray(1)).toString('utf16le') : Buffer.from(value.subarray(1)).toString('latin1');
  found.push({ file, origin: ks.slice(1, sep), value: val });
};

for (const f of fs.readdirSync(dir)) {
  const p = path.join(dir, f), buf = fs.readFileSync(p);
  if (f.endsWith('.ldb')) {
    try {
      const footer = buf.subarray(buf.length - 48);
      let pos = 0, mOff, mSize, iOff, iSize;
      [mOff, pos] = varint(footer, pos); [mSize, pos] = varint(footer, pos); [iOff, pos] = varint(footer, pos); [iSize, pos] = varint(footer, pos);
      const index = readBlock(buf, iOff, iSize);
      for (const [, handle] of blockEntries(index)) {
        let o, s; [o] = varint(handle, 0); [s] = varint(handle, varint(handle, 0)[1]);
        for (const [k, v] of blockEntries(readBlock(buf, o, s))) consider(f, k, v);
      }
    } catch (e) { console.error(`  ${f}: ${e.message}`); }
  } else if (f.endsWith('.log')) {
    /* 32 KB blocks of records: [crc 4][len 2][type 1][payload]; a batch payload is
       [seq 8][count 4] then records [kind 1][klen varint][key][vlen varint][value]. */
    let pos = 0, frag = [];
    while (pos + 7 <= buf.length) {
      const len = buf.readUInt16LE(pos + 4), type = buf[pos + 6];
      const payload = buf.subarray(pos + 7, pos + 7 + len); pos += 7 + len;
      if (len === 0 && type === 0) { pos = Math.ceil(pos / 32768) * 32768; continue; }
      frag.push(payload);
      if (type === 1 || type === 4) {
        const batch = Buffer.concat(frag); frag = [];
        try {
          let p = 12; const count = batch.readUInt32LE(8);
          for (let i = 0; i < count; i++) {
            const kind = batch[p++]; let kl, vl;
            [kl, p] = varint(batch, p); const key = batch.subarray(p, p + kl); p += kl;
            if (kind === 1) { [vl, p] = varint(batch, p); const value = batch.subarray(p, p + vl); p += vl; consider(f, Buffer.concat([key, Buffer.alloc(8)]), value); }
          }
        } catch { /* partial record */ }
      }
    }
  }
}
const seen = new Set();
for (const r of found) {
  if (seen.has(r.value)) continue; seen.add(r.value);
  let lib; try { lib = JSON.parse(r.value); } catch { continue; }
  if (!Array.isArray(lib)) continue;
  const withP = lib.filter(g => g.priority);
  const newest = Math.max(0, ...lib.map(g => g.addedAt || 0));
  console.log(`${r.file.padEnd(12)} ${r.origin.padEnd(28)} ${String(lib.length).padStart(4)} games  ${String(withP.length).padStart(4)} with priority  newest addedAt ${newest ? new Date(newest).toISOString().slice(0,16) : '-'}`);
}
if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify([...seen].map(v => JSON.parse(v)).filter(Array.isArray)));
console.log(`${seen.size} distinct versions`);
