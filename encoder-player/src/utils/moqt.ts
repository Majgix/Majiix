import { streamWriterEncoder, streamReaderDecoder } from "./stream";
import { concatBuffer, buffRead } from "./buffer_utils";

export interface Moqt {
  wt: WebTransport | null;
  controlReader: ReadableStream | null;
  controlWriter: WritableStream | null;
  controlStream?: { writable: WritableStream, readable: ReadableStream };
}

interface Params {
  authInfo: string | null,
  role: number | null,
  [key: string]: any,
}

export async function moqCreateControlStream(moqt: Moqt): Promise<void> {
  if (moqt.wt === null) {
    throw new Error("Null WebTransport Session");
  }
  if (moqt.controlReader != null || moqt.controlWriter != null) {
    throw new Error("Either controlReader or controlWriter must be null");
  }

  moqt.controlStream = await moqt.wt.createBidirectionalStream();
  moqt.controlWriter = moqt.controlStream.writable;
  moqt.controlReader = moqt.controlStream.readable;
}

// Setup

function createMoqSetupMessage(role: number) {
  const messageType = streamWriterEncoder(MOQ_MESSAGE_CLIENT_SETUP);
  const versionLength = streamWriterEncoder(1);
  const version = streamWriterEncoder(MOQ_DRAFT01_VERSION);
  const numberOfParams = streamWriterEncoder(1);
  const roleParamId = streamWriterEncoder(MOQ_PARAMETER_ROLE);
  const roleParamData = streamWriterEncoder(role);
  const roleParamRoleLength = streamWriterEncoder(roleParamData.byteLength);

  return concatBuffer([messageType, versionLength, version, numberOfParams, roleParamId, roleParamRoleLength, roleParamData]);
}

export async function moqSendSetup (writer: WritableStream, role: number) {
  return moqSend(writer, createMoqSetupMessage(role));
}

export async function parseSetupResponse(readerStream: ReadableStream) {
  const ret = { version: 0, parameters: { authInfo: null, role: null} as Params };
  const type = await streamReaderDecoder(readerStream);

  if (type !== MOQ_MESSAGE_SERVER_SETUP) {
    throw new Error(`Setup answer must be ${MOQ_MESSAGE_SERVER_SETUP}, got ${type}`);
  }
  ret.version = await streamReaderDecoder(readerStream);
  if (ret.version !== MOQ_DRAFT01_VERSION) {
    throw new Error(`version sent from server NOT supported. must be ${MOQ_DRAFT01_VERSION}`);
  }

  ret.parameters = await readMoqParams(readerStream);

  return ret;
}

// Announce

export function createAnnounceMessage(namespace: string, authInfo: string) {
  // Message type
  const messageTypeBytes = streamWriterEncoder(MOQ_MESSAGE_ANNOUNCE);
  
  // Namespace
  const namespaceBytes = createStringBytes(namespace);

  // no. of parameters
  const numberOfParamsBytes = streamWriterEncoder(1);

  // param[0]: authinfo
  const authInfoIdBytes = streamWriterEncoder(MOQ_PARAMETER_AUTHORIZATION_INFO);
  // param[0]: authinfo value
  const authInfoBytes = createStringBytes(authInfo);

  return concatBuffer([messageTypeBytes, namespaceBytes, numberOfParamsBytes, authInfoIdBytes, authInfoBytes]);
}

export async function moqSendAnnounce(writer: WritableStream, namespace: string, authInfo: string) {
  return moqSend(writer, createAnnounceMessage(namespace, authInfo))
}

export async function parseAnnounceResponse(readerStream: ReadableStream) {
  const type = await streamReaderDecoder(readerStream);
  if (type !== MOQ_MESSAGE_ANNOUNCE_OK) {
    throw new Error(`ANNOUNCE answer type must be ${MOQ_MESSAGE_ANNOUNCE_OK}, got ${type}`);
  }
    // Track namespace
  const namespace = await moqStringRead(readerStream);

  return { namespace };
}

// Subscribe 

function createSubscribeMessage (trackNamespace: string, trackName: string, authInfo: string) {
  // Message type
  const messageTypeBytes = streamWriterEncoder(MOQ_MESSAGE_SUBSCRIBE);

  // Track namespace
  const trackNamespaceBytes = createStringBytes(trackNamespace);

  // Track name
  const trackNameBytes = createStringBytes(trackName);

  // Start group
  const startGroupBytesMode = streamWriterEncoder(MOQ_LOCATION_MODE_RELATIVE_NEXT);
  const startGroupBytesValue = streamWriterEncoder(0);
  
  // Start Object
  const startObjectBytesMode = streamWriterEncoder(MOQ_LOCATION_MODE_ABSOLUTE);
  const startObjectBytesValue = streamWriterEncoder(0);

  // End group
  const endGroupBytesMode = streamWriterEncoder(MOQ_LOCATION_MODE_NONE);
  // End Object
  const endObjectBytesMode = streamWriterEncoder(MOQ_LOCATION_MODE_NONE);

  // Params
  // no. of parameters
  const numberOfParamsBytes = streamWriterEncoder(1);
  // param[0]: auth info id
  const authInfoIdParamBytes = streamWriterEncoder(MOQ_PARAMETER_AUTHORIZATION_INFO);
  // param[0]: length + auth info
  const authInfoBytes = createStringBytes(authInfo);

  return concatBuffer([messageTypeBytes, 
    trackNamespaceBytes, 
    trackNameBytes, 
    startGroupBytesMode, 
    startGroupBytesValue, 
    startObjectBytesMode, 
    startObjectBytesValue, 
    endGroupBytesMode, 
    endObjectBytesMode, 
    numberOfParamsBytes, 
    authInfoIdParamBytes, 
    authInfoBytes
  ]);
}

function createSubscribeResponseMessage(namespace: string, trackName: string, trackId: number, expiresMs: number) {
  // Message type
  const messageTypeBytes = streamWriterEncoder(MOQ_MESSAGE_SUBSCRIBE_OK)

  // Track namespace
  const trackNamespaceBytes = createStringBytes(namespace)
  // Track name
  const trackNameBytes = createStringBytes(trackName)
  // Track id
  const trackIdBytes = streamWriterEncoder(trackId)
  // Expires MS
  const expiresMsBytes = streamWriterEncoder(expiresMs)

  return concatBuffer([messageTypeBytes, trackNamespaceBytes, trackNameBytes, trackIdBytes, expiresMsBytes]);
}

export async function moqSendSubscribe(writerStream: WritableStream, trackNamespace: string, trackName: string, authInfo: string) {
  return moqSend(writerStream, createSubscribeMessage(trackNamespace, trackName, authInfo))
}

export async function parseSubscribeResponse(readerStream: ReadableStream) {
  const ret = { namespace: '', trackName: '', trackId: -1, expires: -1 }
    const type = await streamReaderDecoder(readerStream)
    if (type !== MOQ_MESSAGE_SUBSCRIBE_OK) {
      throw new Error(`SUBSCRIBE answer type must be ${MOQ_MESSAGE_SUBSCRIBE_OK}, got ${type}`)
    } 
    // Track namespace
    ret.namespace = await moqStringRead(readerStream)
    // Track name
    ret.trackName = await moqStringRead(readerStream)
    // Track Id
    ret.trackId = await streamReaderDecoder(readerStream)
    // Expires
    ret.expires = await streamReaderDecoder(readerStream)
  
    return ret
}

export async function moqParseSubscribe (readerStream: ReadableStream) { 
   const ret: { 
       namespace: string; 
       trackName: string; 
       startGroup: number; 
       startObject: number; 
       endGroup: number; 
       endObject: number; 
       parameters: Params | null; 
     } = { 
       namespace: '', 
       trackName: '', 
       startGroup: -1, 
       startObject: -1, 
       endGroup: -1, 
       endObject: -1, 
       parameters: null 
     };


  const type = await streamReaderDecoder(readerStream)
  if (type !== MOQ_MESSAGE_SUBSCRIBE) {
    throw new Error(`SUBSCRIBE type must be ${MOQ_MESSAGE_SUBSCRIBE}, got ${type}`)
  }

  // Track namespace
  ret.namespace = await moqStringRead(readerStream)

  // Track name
  ret.trackName = await moqStringRead(readerStream)

  // Start group
  ret.startGroup = await streamReaderDecoder(readerStream)
  if (ret.startGroup !== MOQ_LOCATION_MODE_NONE) {
    await streamReaderDecoder(readerStream)
  }

  // Start object
  ret.startObject = await streamReaderDecoder(readerStream)
  if (ret.startObject !== MOQ_LOCATION_MODE_NONE) {
    await streamReaderDecoder(readerStream)
  }

  // End group
  ret.endGroup = await streamReaderDecoder(readerStream)
  if (ret.endGroup !== MOQ_LOCATION_MODE_NONE) {
    await streamReaderDecoder(readerStream)
  }

  // End object
  ret.endObject = await streamReaderDecoder(readerStream)
  if (ret.endObject !== MOQ_LOCATION_MODE_NONE) {
    await streamReaderDecoder(readerStream)
  }


  ret.parameters = await readMoqParams(readerStream);

  return ret
}

export async function moqSendSubscribeResponse (writerStream: WritableStream, namespace: string, trackName: string, trackId: number, expiresMs: number) {
  return moqSend(writerStream, createSubscribeResponseMessage(namespace, trackName, trackId, expiresMs))
}

// OBJECT
// TODO: Send also objects with length, only useful if I put more than one in a quic stream

function moqCreateObjectBytes (trackId: number, groupSeq: number, objSeq: number, sendOrder: number, data: Uint8Array) {
  // Message type
  const messageTypeBytes = streamWriterEncoder(MOQ_MESSAGE_OBJECT)
  const trackIdBytes = streamWriterEncoder(trackId)
  const groupSeqBytes = streamWriterEncoder(groupSeq)
  const objSeqBytes = streamWriterEncoder(objSeq)
  const sendOrderBytes = streamWriterEncoder(sendOrder)

  return concatBuffer([messageTypeBytes, trackIdBytes, groupSeqBytes, objSeqBytes, sendOrderBytes, data])
}

export function moqSendObjectToWriter (writer: WritableStreamDefaultWriter, trackId: number, groupSeq: number, objSeq: number, sendOrder: number, data: Uint8Array) {
  return moqSendToWriter(writer, moqCreateObjectBytes(trackId, groupSeq, objSeq, sendOrder, data))
}

export async function moqParseObjectHeader (readerStream: ReadableStream) {
  const type = await streamReaderDecoder(readerStream)
  if (type !== MOQ_MESSAGE_OBJECT && type !== MOQ_MESSAGE_OBJECT_WITH_LENGTH) {
    throw new Error(`OBJECT answer type must be ${MOQ_MESSAGE_OBJECT} or ${MOQ_MESSAGE_OBJECT_WITH_LENGTH}, got ${type}`)
  }

  const trackId = await streamReaderDecoder(readerStream)
  const groupSeq = await streamReaderDecoder(readerStream)
  const objSeq = await streamReaderDecoder(readerStream)
  const sendOrder = await streamReaderDecoder(readerStream)
   
  const ret: { trackId: number; groupSeq: number; objSeq: number; sendOrder: number; payloadLength?: number } = {
      trackId,
      groupSeq,
      objSeq,
      sendOrder,
    };
  
  if (type === MOQ_MESSAGE_OBJECT_WITH_LENGTH) {
    ret.payloadLength = await streamReaderDecoder(readerStream)
  }
  return ret
}

// Helpers

function createStringBytes(str: string) {
  const dataStrBytes = new TextEncoder().encode(str);
  const dataStrLengthBytes = streamWriterEncoder(dataStrBytes.byteLength);
  return concatBuffer([dataStrLengthBytes, dataStrBytes]);
}

async function moqStringRead (readerStream: ReadableStream) {
  const size = await streamReaderDecoder(readerStream);
  const buff = await buffRead(readerStream, size);
  if (buff === null) {
    throw new Error("Failed to read buffer from stream");
  }
  return new TextDecoder().decode(buff);
}

async function moqSend(writerStream: WritableStream, data: Uint8Array) {
  const writer = writerStream.getWriter();
  moqSendToWriter(writer, data)
  await writer.ready;
  writer.releaseLock();
}

async function readMoqParams(readerStream: ReadableStream) {
  const ret: Params = { authInfo: null, role: null };
  // Params
  const numberOfParams = await streamReaderDecoder(readerStream);
  if (numberOfParams > MOQ_MAX_PARAMS) {
    throw new Error(`Exceeded the max number of supported ${MOQ_MAX_PARAMS}, got ${numberOfParams}`);
  } 
  for (let i = 0; i < numberOfParams; i++) {
    const paramId = await streamReaderDecoder(readerStream);
    if (paramId === MOQ_PARAMETER_AUTHORIZATION_INFO) {
      ret.authInfo = await moqStringRead(readerStream);
    } else if (paramId === MOQ_PARAMETER_ROLE) {
      await streamReaderDecoder(readerStream);
      ret.role = await streamReaderDecoder(readerStream);
    } else {
      const paramLength = await streamReaderDecoder(readerStream);
      const skip = await buffRead(readerStream, paramLength);
      ret[`unknown-${i}-${paramId}-${paramLength}`] = JSON.stringify(skip)
    }
  }
  return ret;
}

async function moqSendToWriter(writer: WritableStreamDefaultWriter, data: Uint8Array) {
  writer.write(data);
}

// MoQ definitions

export const MOQ_DRAFT01_VERSION = 0xff000001;

export const MOQ_PARAMETER_ROLE = 0x0;
export const MOQ_PARAMETER_AUTHORIZATION_INFO = 0x2;

export const MOQ_MAX_PARAMS = 256;
export const MOQ_MAX_ARRAY_LENGTH = 1024;

export const MOQ_PARAMETER_ROLE_INVALID = 0x0;
export const MOQ_PARAMETER_ROLE_PUBLISHER = 0x1;
export const MOQ_PARAMETER_ROLE_SUBSCRIBER = 0x2;
export const MOQ_PARAMETER_ROLE_BOTH = 0x3;

// MoQ messages
const MOQ_MESSAGE_OBJECT = 0x0;
const MOQ_MESSAGE_OBJECT_WITH_LENGTH = 0x2;
const MOQ_MESSAGE_CLIENT_SETUP = 0x40;
const MOQ_MESSAGE_SERVER_SETUP = 0x41;

const MOQ_MESSAGE_SUBSCRIBE = 0x3;
const MOQ_MESSAGE_SUBSCRIBE_OK = 0x4;

const MOQ_MESSAGE_ANNOUNCE = 0x6;
const MOQ_MESSAGE_ANNOUNCE_OK = 0x7;

// Location modes
export const MOQ_LOCATION_MODE_NONE = 0x0
export const MOQ_LOCATION_MODE_ABSOLUTE = 0x1
export const MOQ_LOCATION_MODE_RELATIVE_PREVIOUS = 0x2
export const MOQ_LOCATION_MODE_RELATIVE_NEXT = 0x3

export {};
