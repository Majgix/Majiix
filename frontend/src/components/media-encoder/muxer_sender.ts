import { State } from "./utils";
console.log("Initiating muxer-sender...");
let workerState = State.Created;

// Default values
const inFlightRequests = {
  audio: {},
  video: {},
};

let urlHostPort = "127.0.0.1";
let urlPath = "4443";

// Inflight req abort signal
const abortController = new AbortController();

// WebTransport data
let wTransport: WebTransport | null = null;

interface ChunkData {
  mediaType: string;
  chunk: any;
}

self.addEventListener("message", async function (event: MessageEvent) {
  console.log("muxer-sender listening for events!");
  if (workerState === State.Created) {
    workerState = State.Instatiated;
  }

  if (workerState === State.Stopped) {
    console.log("muxer-sender worker stopped");
    return;
  }

  let type = event.data.type;

  switch (type) {
    case "stop":
      try {
        abortController.abort();
        await Promise.all(getAllInflightRequestsArray());

        if (wTransport != null) {
          await wTransport.close();
          wTransport = null;
        }
      } catch (err) {
        console.error(err);
      }
      return;
    case "muxersenderini":
      if (workerState !== State.Instatiated) {
        return;
      }

      await createWebTransportSession(`https://${urlHostPort}:${urlPath}`);

      workerState = State.Running;
      return;
  }

  let mediaType = "unknown";
  if (type === "videochunk") {
    mediaType = "video";
  } else if (type === "audiochunk") {
    mediaType = "audio";
  }

  if (workerState !== State.Running) {
    return;
  }

  const chunkData: ChunkData = {
    mediaType: mediaType,
    chunk: event.data.chunk,
  };

  if (mediaType === "audio" || mediaType === "video") {
    sendChunkToTransport(chunkData);
  }

  return;
});

function sendChunkToTransport(chunkData: ChunkData) {
  if (chunkData == null) {
    return;
  }
  return createRequests(chunkData);
}

function getAllInflightRequestsArray() {
  const arrAudio = Object.values(inFlightRequests.audio);
  const arrVideo = Object.values(inFlightRequests.video);

  return arrAudio.concat(arrVideo);
}

function createRequests(chunkData: ChunkData) {
  if (chunkData !== null) {
    const ret = [];
    const mediaType = chunkData.mediaType;
    const chunk = chunkData.chunk;

    const chunkDataBuffer = new Uint8Array(chunk.byteLength);
    chunk.copyTo(chunkDataBuffer);

    let pChunk = null;
    pChunk = createWebTransportRequestPromise(mediaType, chunk.type);
    ret.push(pChunk);

    ret;
  }
}

async function createWebTransportSession(url: string) {
  if (wTransport != null) {
    return;
  }
  wTransport = new WebTransport(url);
  await wTransport.ready;

  wTransport.closed;
}

async function createWebTransportRequestPromise(
  mediaType: string,
  chunkType: string,
): Promise<void> {
  if (wTransport === null) {
    return;
  }

  try {
    const uniStream = await wTransport.createUnidirectionalStream();
    const uniWriter = uniStream.getWriter();
    await uniWriter.ready;

    const chunkObject = {
      mediaType,
      chunkType,
    };

    const objectBytes = new TextEncoder().encode(JSON.stringify(chunkObject));

    uniWriter.write(objectBytes);

    const p = uniWriter.close();
  } catch (err: any) {
    console.error(err);
  }
  return;
}

export {};
