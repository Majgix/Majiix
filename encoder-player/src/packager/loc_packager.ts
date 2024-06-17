import { streamReaderDecoder } from "../utils/stream";
import { readUntilEof  } from "../utils/buffer_utils";

export class LocPackager {
  mediaType: string = '';
  timestamp: number = 0;
  chunkType: string = '';

  pId: string = '';

  data: any = null;

  readonly READ_BLOCK_SIZE: number = 1024;

  SetData(
    mediaType: string,
    timestamp: number,
    chunkType: string,
    data: any
  ) {
    const pId = btoa(`${mediaType}-${timestamp}-${chunkType}-${Math.floor(Math.random() * 100000)}`);

    this.timestamp = timestamp;

    this.mediaType = mediaType;
    this.chunkType = chunkType;

    this.pId = pId; // Internal

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
    // this.timestamp = await varIntToNumber(readerStream);
    this.data = await readUntilEof(readerStream, this.READ_BLOCK_SIZE)
  }

}
 export {}
