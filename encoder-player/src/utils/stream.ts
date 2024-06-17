import { byobReader } from "./buffer_utils";

const MAX_U6 = Math.pow(2, 6) - 1
const MAX_U14 = Math.pow(2, 14) - 1
const MAX_U30 = Math.pow(2, 30) - 1
const MAX_U53 = Number.MAX_SAFE_INTEGER

export function streamWriterEncoder (v: number) {
 if (v <= MAX_U6) {
  return setUint8(v)
 } else if (v <= MAX_U14) {
  return setUint16(v | 0x4000)
 } else if (v <= MAX_U30) {
  return setUint32(v | 0x80000000)
 } else if (v <= MAX_U53) {
  return setUint64(BigInt(v) | 0xc000000000000000n)
 } else {
  throw new Error(`overflow, value larger than 53-bits: ${v}`)
 }
}

export async function streamReaderDecoder(readableStream: ReadableStream) {
  let ret;
  const reader = readableStream.getReader({ mode: 'byob' });
  try {
    let buff: ArrayBufferLike = new ArrayBuffer(8);

    // asynchronously read data from a BYOB reader to provided buffer
    buff = await byobReader(reader, buff, 0, 1); 
    // mask the byte, extracting the two most significant bits
    const size = (new DataView(buff, 0, 1).getUint8(0) & 0xc0) >> 6;
    if (size === 0) {
      ret = new DataView(buff, 0, 1).getUint8(0) & 0x3f;
    } else if (size === 1) {
      buff = await byobReader(reader, buff, 1, 1);
      ret = new DataView(buff, 0, 2).getUint16(0) & 0x3fff;
    } else if (size === 2) {
      buff = await byobReader(reader, buff, 1, 3);
      ret = new DataView(buff, 0, 4).getUint32(0) & 0x3fffffff;
    } else if (size === 3) {
      buff = await byobReader(reader, buff, 1, 7);
      ret = Number(new DataView(buff, 0, 8).getBigUint64(0) & BigInt('0x3fffffffffffffff'));
    } else {
      throw new Error('impossible');
    }
  } finally {
    reader.releaseLock()
  }

  return ret;
  
}

function setUint8 (v: number) {
 const ret = new Uint8Array(1)
 ret[0] = v
 return ret
}

function setUint16 (v: number) {
 const ret = new Uint8Array(2)
 const view = new DataView(ret.buffer)
 view.setUint16(0, v)
 return ret
}

function setUint32 (v: number) {
 const ret = new Uint8Array(4)
 const view = new DataView(ret.buffer)
 view.setUint32(0, v)
 return ret
}

function setUint64 (v: number | bigint) {
 const ret = new Uint8Array(8)
 const view = new DataView(ret.buffer)
 view.setBigUint64(0, BigInt(v))
 return ret
}

export {}