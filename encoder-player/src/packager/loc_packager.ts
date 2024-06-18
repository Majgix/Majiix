import { streamReaderDecoder, streamWriterEncoder } from "../utils/stream";
import { buffRead, readUntilEof, concatBuffer  } from "../utils/buffer_utils";

export class LocPackager {
  mediaType: string = '';
  timestamp: number = 0;
  duration: number = 0;
  chunkType: string = '';
  seqId: number = -1;

  pId: string = '';
  data: any = null;
  metadata: any = null;

  readonly READ_BLOCK_SIZE: number = 1024;

  SetData(
    mediaType: string,
    timestamp: number,
    duration: number,
    chunkType: string,
    seqId: number,
    metadata: any,
    data: any
  ) {
    const pId = btoa(`${mediaType}-${timestamp}-${chunkType}-${seqId}-${Math.floor(Math.random() * 100000)}`);
    
    this.seqId = seqId
    this.timestamp = timestamp;

    this.mediaType = mediaType;
    this.duration = duration
    this.chunkType = chunkType;

    this.pId = pId; 
    this.metadata = metadata
    this.data = data;
  }

  async ReadBytes (readerStream: ReadableStream) {
    const mediaTypeInt = await streamReaderDecoder(readerStream);
    if (mediaTypeInt === 0) {
      this.mediaType = 'data';
    } else if (mediaTypeInt === 1) {
      this.mediaType = 'audio';
    } else if (mediaTypeInt === 2) {
      this.mediaType = 'video';
    } else {
      throw new Error(`MediaType ${mediaTypeInt} not supported`);
    }
    
    const chunkTypeInt = await streamReaderDecoder(readerStream);
    if (chunkTypeInt === 0) {
      this.chunkType = 'delta';
    } else if (chunkTypeInt === 1) {
      this.chunkType = 'key';
    } else {
      throw new Error(`chunkType ${chunkTypeInt} not supported`);
    }

    this.seqId = await streamReaderDecoder(readerStream);
    this.timestamp = await streamReaderDecoder(readerStream);
    this.duration = await streamReaderDecoder(readerStream);
    const metadataSize = await streamReaderDecoder(readerStream);
    if (metadataSize > 0) {
      this.metadata = await buffRead(readerStream, metadataSize);
    } else {
      this.metadata = null;
    }
    this.data = await readUntilEof(readerStream, this.READ_BLOCK_SIZE)
  }

  GetData () {
    return {
      seqId: this.seqId,
      timestamp: this.timestamp,

      mediaType: this.mediaType,
      duration: this.duration,
      chunkType: this.chunkType,

      pId: this.pId, // Internal

      data: this.data,
      metadata: this.metadata
    }
  }

  GetDataStr () {
    const metadataSize = (this.metadata === undefined || this.metadata == null) ? 0 : this.metadata.byteLength;
    const dataSize = (this.data === undefined || this.data == null) ? 0 : this.data.byteLength;
    return `${this.mediaType} - ${this.seqId} - ${this.timestamp} - ${this.duration} - ${this.chunkType} - ${metadataSize} - ${dataSize}`;
  }

  ToBytes () {
    let mediaTypeBytes: Uint8Array;
    if (this.mediaType === 'data') {
      mediaTypeBytes = streamWriterEncoder(0);
    } else if (this.mediaType === 'audio') {
      mediaTypeBytes = streamWriterEncoder(1);
    } else if (this.mediaType === 'video') {
      mediaTypeBytes = streamWriterEncoder(2);
    } else {
      throw new Error(`Mediatype ${this.mediaType} not supported`)
    }

    let chunkTypeBytes: Uint8Array;
    if (this.chunkType === 'delta') {
      chunkTypeBytes = streamWriterEncoder(0);
    } else if (this.chunkType === 'key') {
      chunkTypeBytes = streamWriterEncoder(1);
    } else {
      throw new Error(`chunkType ${this.chunkType} not supported`);
    }

    const seqIdBytes = streamWriterEncoder(this.seqId);
    const timestampBytes = streamWriterEncoder(this.timestamp);

    const durationBytes = streamWriterEncoder(this.duration);

    const metadataSize = (this.metadata === undefined || this.metadata == null) ? 0 : this.metadata.byteLength;
    const metadataSizeBytes = streamWriterEncoder(metadataSize);
    let ret = null;
    if (metadataSize > 0) {
      ret = concatBuffer([mediaTypeBytes, chunkTypeBytes, seqIdBytes, timestampBytes, durationBytes, metadataSizeBytes, this.metadata, this.data])
    } else {
      ret = concatBuffer([mediaTypeBytes, chunkTypeBytes, seqIdBytes, timestampBytes, durationBytes, metadataSizeBytes, this.data])
    }
    return ret
  }

}
 export {}
