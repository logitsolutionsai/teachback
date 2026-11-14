// A small ZIP writer and a defensive ZIP reader, on Node core only.
//
// The writer stores entries uncompressed, in the order given, with one fixed
// timestamp (1980-01-01 00:00), no extra fields and UTF-8 names, so the same
// files always give the same bytes on every machine and Node version.
//
// The reader refuses: names that are absolute, climb out with "..", use
// backslashes or drive letters; duplicate names (also by case); symlink and
// device entries; encryption; methods other than stored and deflate; ZIP64;
// more than maxEntries entries; an entry over maxEntryBytes; a total over
// maxTotalBytes; a compression ratio over maxRatio; and any CRC or size that
// does not match. Inflation is capped at the declared size.
import zlib from 'node:zlib';
import { checkRelPath } from '../repo/paths.mjs';

export const READ_LIMITS = Object.freeze({ maxEntries: 1000, maxEntryBytes: 2 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024, maxRatio: 100, maxArchiveBytes: 16 * 1024 * 1024 });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01

// entries: [{ name, data: Buffer }]
export function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 38); // external attributes: a plain file
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export class ZipError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Returns [{ name, data }] in archive order, or throws ZipError.
export function readZip(buf, limits = {}) {
  const L = { ...READ_LIMITS, ...limits };
  const fail = (code, msg) => {
    throw new ZipError(code, msg);
  };
  if (buf.length > L.maxArchiveBytes) fail('ZIP_TOO_LARGE', `The archive is ${buf.length} bytes; the limit is ${L.maxArchiveBytes}.`);
  if (buf.length < 22) fail('ZIP_INVALID', 'Not a ZIP archive.');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail('ZIP_INVALID', 'No end-of-archive record: not a ZIP archive, or a damaged one.');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 8) !== count) fail('ZIP_UNSUPPORTED', 'Multi-part archives are not supported.');
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) fail('ZIP_UNSUPPORTED', 'ZIP64 archives are not supported.');
  if (count > L.maxEntries) fail('ZIP_TOO_MANY', `The archive has ${count} entries; the limit is ${L.maxEntries}.`);
  if (cdOffset + cdSize > eocd) fail('ZIP_INVALID', 'The central directory is outside the archive.');
  const out = [];
  const seen = new Set();
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) fail('ZIP_INVALID', 'A central directory record is damaged.');
    const madeBy = buf.readUInt16LE(p + 4) >> 8;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (flags & 0x1) fail('ZIP_ENCRYPTED', `"${name}" is encrypted.`);
    const mode = ext >>> 16;
    if (madeBy === 3 && (mode & 0xf000) !== 0 && (mode & 0xf000) !== 0x8000 && (mode & 0xf000) !== 0x4000) fail('ZIP_SPECIAL', `"${name}" is a symlink or special file.`);
    if (name.endsWith('/')) {
      if (usize !== 0) fail('ZIP_INVALID', `Folder entry "${name}" has data.`);
      continue;
    }
    const safe = checkRelPath(name);
    if (!safe.ok) fail('ZIP_PATH', `Entry "${name}" is refused: ${safe.reason}.`);
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key)) fail('ZIP_DUPLICATE', `Entry "${name}" appears more than once.`);
    seen.add(key);
    if (![0, 8].includes(method)) fail('ZIP_UNSUPPORTED', `"${name}" uses compression method ${method}.`);
    if (usize > L.maxEntryBytes) fail('ZIP_ENTRY_TOO_LARGE', `"${name}" expands to ${usize} bytes; the limit is ${L.maxEntryBytes}.`);
    if (csize > 0 && usize / csize > L.maxRatio) fail('ZIP_BOMB', `"${name}" expands ${Math.round(usize / csize)} times; the limit is ${L.maxRatio}.`);
    total += usize;
    if (total > L.maxTotalBytes) fail('ZIP_BOMB', `The archive expands to more than ${L.maxTotalBytes} bytes.`);
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) fail('ZIP_INVALID', `The local header of "${name}" is damaged.`);
    const lnlen = buf.readUInt16LE(lho + 26);
    const lxlen = buf.readUInt16LE(lho + 28);
    if (buf.subarray(lho + 30, lho + 30 + lnlen).toString('utf8') !== name) fail('ZIP_INVALID', `The local and central names of "${name}" differ.`);
    const start = lho + 30 + lnlen + lxlen;
    if (start + csize > cdOffset) fail('ZIP_INVALID', `The data of "${name}" overlaps the directory.`);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) {
      if (csize !== usize) fail('ZIP_INVALID', `"${name}" is stored but its sizes differ.`);
      data = Buffer.from(raw);
    } else {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, usize) });
      } catch {
        fail('ZIP_BOMB', `"${name}" expands beyond its declared size or is damaged.`);
      }
    }
    if (data.length !== usize) fail('ZIP_INVALID', `"${name}" has ${data.length} bytes, not the declared ${usize}.`);
    if (crc32(data) !== crc) fail('ZIP_CRC', `"${name}" fails its checksum.`);
    out.push({ name, data });
  }
  return out;
}

// JSON.parse, plus a refusal of duplicate keys (which JSON.parse silently resolves).
export function parseJsonStrict(text) {
  const value = JSON.parse(text);
  const stack = [];
  let i = 0;
  const readString = () => {
    let s = '';
    i += 1;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') {
        s += text.slice(i, i + 2);
        i += 2;
      } else s += text[i++];
    }
    i += 1;
    return JSON.parse(`"${s}"`);
  };
  while (i < text.length) {
    const ch = text[i];
    const top = stack.at(-1);
    if (ch === '"') {
      const s = readString();
      if (top?.type === 'obj' && top.expectKey) {
        if (top.keys.has(s)) throw new SyntaxError(`duplicate key "${s}"`);
        top.keys.add(s);
        top.expectKey = false;
      }
      continue;
    }
    if (ch === '{') stack.push({ type: 'obj', keys: new Set(), expectKey: true });
    else if (ch === '[') stack.push({ type: 'arr' });
    else if (ch === '}' || ch === ']') stack.pop();
    else if (ch === ',' && top?.type === 'obj') top.expectKey = true;
    i += 1;
  }
  return value;
}
