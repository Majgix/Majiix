import "./utils";
import { State, sendMessageToMain } from './utils';

const WORKER_PREFIX = "[MUXER_SENDER]";

let chunks_delivered = 0;
let workerState = State.Created;

// Default values
let maxAgeChunks = 120;

type maxFlightRequests = {
    audio: any,
    video: any,
}

const maxFlightRequests: maxFlightRequests = {
  'audio': 4,
  'video': 2,
}

interface inFlightRequest {
}

interface InFlightRequestsType {
  audio: Record<string, InFlight>;
  video: Record<string, InFlight>;
};


const inFlightRequests: InFlightRequestsType = {
  'audio': {},
  'video': {},
}

interface InFlight {
  id: number,
}

let urlHostPort = "";
let urlPath = "";

// Inflight req abort signal
const abortController = new AbortController();

// WebTransport data
let wTransport: WebTransport | null = null;

// Packager efficiency
let efficiencyData = {
    audio: {
        totalPackagerBytesSent: 0,
        totalPayloadBytesSent: 0,
    },
    video: {
        totalPackagerBytesSent: 0,
        totalPayloadBytesSent: 0,
    }
}

interface chunkData {
    mediaType: string,
    firstFrameclkms: number,
    compesatedTs: number,
    estimatedDuration: number,
    seqId: number,
    maxAgeChunks: number,
    chunk: any,
    metadata: EncodedAudioChunkMetadata | EncodedVideoChunkMetadata | null, 
}

self.addEventListener('message', async function(event) {
  if (workerState === State.Created) {
    workerState = State.Instatiated;

  }
  
  if (workerState === State.Stopped) {
    sendMessageToMain(WORKER_PREFIX, "info", "Muxer-send is Stopped");
    return;
  }

  let type = event.data.type;

  switch (type) {
    case "stop":
      try{
        abortController.abort();
        await Promise.all(getAllInflightRequetsArray());

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
        sendMessageToMain(WORKER_PREFIX, "error", "received init message in wrong state: " + workerState);
        return;
      }

      let type = event.data.muxerSenderConfig;
      switch (type) {

      
        case "maxInflightAudioRequests":
          maxFlightRequests['audio'] = event.data.muxerSenderConfig.maxInflightAudioRequests;
          return;
        case "maxInflightVideoRequests":
          maxFlightRequests['video'] = event.data.muxerSenderConfig.maxInflightVideoRequests;
          return;
        case "urlHostPort":
          urlHostPort = event.data.muxerSenderConfig.urlHostPort;
          return;
        case "urlPath":
          urlPath = event.data.muxerSenderConfig.urlPath;
          return;
        case "maxAgeChunks":

          maxAgeChunks = event.data.muxerSenderConfig.maxAgeChunks;
          return;
        
        await createWebTransportSession(urlHostPort + "/" + urlPath);
        sendMessageToMain(WORKER_PREFIX, "info", "Initialized");

        workerState = State.Running;
        return;
      }
  }

  if ((type != "videochunk") && (type != "audiochunk")) {
    sendMessageToMain(WORKER_PREFIX, "error", "Invalid message received");
    return;
  }

  let mediaType = "unknown";
  if (type === "videochunk") {
    mediaType = "video";
  } else if (type === "audichunk") {
    mediaType = "audio";
  }

  if (workerState !== State.Running) {
    sendMessageToMain(WORKER_PREFIX, "dropped", {
      clkms: Date.now(),
      seqId: event.data.seqId,
      mediaType: mediaType,inFlightRequests,
      ts: event.data.chunk.timestamp,
      msg: "Dropped chunk because transport is not open yet"
    });
    return;
  }

  const chunkData = {
    mediaType: mediaType,
    firstFrameclkms: event.data.firstFrameclkms,
    compesatedTs: event.data.compesatedTs,
    estimatedDuration: event.data.estimatedDuration,
    seqId: event.data.seqId,
    maxAgeChunks: maxAgeChunks,
    chunk: event.data.chunk,
    metadata: event.data.metadata
  };
  if (mediaType === "audio") {
    sendChunkToTransport(chunkData, inFlightRequests['audio'], maxFlightRequests['audio']);
  } else {
      sendChunkToTransport(chunkData, inFlightRequests['video'], maxFlightRequests['video']);
    }
  inFlightRequests
  // Report stats
  self.postMessage({
    type: "sendstats",
    clkms: Date.now(),
    inFlightAudioReqNum: getInflightRequestsLength(inFlightRequests['audio']),
    inFlightVideoReqNum: getInflightRequestsLength(inFlightRequests['video']),
    efficiencyData: efficiencyData
  });

  return;
});

function sendChunkToTransport(
  chunkData: chunkData,
  inFlightRequests: inFlightRequest,
  maxFlightRequests: maxFlightRequests,
) {
  if (chunkData == null) {
    return;
  } 
  if (getInflightRequestsLength(inFlightRequests) >= maxFlightRequests.audio) {
    sendMessageToMain(WORKER_PREFIX, "dropped", {
      clkms: Date.now(),
      seqId: chunkData.seqId,
      mediaType: chunkData.mediaType,
      ts: chunkData.compesatedTs,
      msg: "Dropped chunk, too many inFlightRequests",
    });
    return;
  }
  return createRequests(chunkData);
}

function getInflightRequestsLength(inFlightRequestsType: inFlightRequest) {
  return Object.keys(inFlightRequestsType).length;
}

function getAllInflightRequetsArray() {
   const arrAudio = Object.values(inFlightRequests['audio']);
   const arrVideo = Object.values(inFlightRequests['video']);

   return arrAudio.concat(arrVideo)
}

function createRequests(chunkData: chunkData) {
  if (chunkData !== null){
    const ret = [];
    const mediaType = chunkData.mediaType;
    const seqId = chunkData.seqId;
    const maxAgeChunks = chunkData.maxAgeChunks;
    const chunk = chunkData.chunk;
    const metadata = chunkData.metadata;
    const firstFrameClkms = chunkData.firstFrameclkms;
    const compesatedTs = chunkData.compesatedTs;
    const estimatedDuration = chunkData.estimatedDuration;
    
    
    if (metadata != undefined) {
        let pIni = null;
        pIni = createWebTransportRequestPromise(
          firstFrameClkms, 
          mediaType, 
          "init", 
          compesatedTs, 
          estimatedDuration, 
          -1, 
          Number.MAX_SAFE_INTEGER, 
          metadata
        );
        ret.push(pIni);
    }

    const chunkDataBuffer = new Uint8Array(chunk.byteLength);
    chunk.copyTo(chunkDataBuffer);

    let pChunk = null;
    pChunk = createWebTransportRequestPromise(firstFrameClkms, mediaType, chunk.type, compesatedTs, estimatedDuration, seqId, maxAgeChunks, metadata);
    ret.push(pChunk);

    ret;
  } 
}


function addToInFlight(mediaType: string, p: InFlight) {
  if (mediaType === 'audio' || mediaType === 'video') {
    if (p.id in inFlightRequests[mediaType]) {
      sendMessageToMain(WORKER_PREFIX, "error", "id already exists in inflight, this should never happen");
    } else {
      inFlightRequests[mediaType][p.id] = p;
    }
  }
}

function removeFromInflight(mediaType: string, id: number) {
  if (mediaType === 'audio' || mediaType === 'video') {
    if (id in inFlightRequests[mediaType]) {
        delete inFlightRequests[mediaType][id];
    }
  }
}

async function createWebTransportSession(url: string) {
  if (wTransport != null) {
    return;
  }
  wTransport = new WebTransport(url);
  await wTransport.ready;

  wTransport.closed
        .then(() => {
            sendMessageToMain(WORKER_PREFIX, "info", "WT closed transport session");
        })
        .catch(error => {
            sendMessageToMain(WORKER_PREFIX, "error", "WT error, closed transport. Err: " + error);
  });
}

async function createWebTransportRequestPromise(
  firstFrameclkms: number,
  mediaType: string,
  chunkType: string,
  compesatedTs: number,
  estimatedDuration: number,
  seqId: number,
  maxAgeChunks: number,
  metadata?: any,
) {
 if (wTransport === null) {
    sendMessageToMain(
      WORKER_PREFIX,
      "dropped",
      {
        clkms: Date.now(),
        ts: compesatedTs,
        msg: "Dropped" + mediaType + "because of server error",
      }
    );
    sendMessageToMain(
      WORKER_PREFIX,
      "error",
      "request not sent because transport is not open",
    );
    return;
  }
  
  try {
    const uniStream = await wTransport.createUnidirectionalStream();
    const uniWriter = uniStream.getWriter();
    await uniWriter.ready;

    const chunkObject = {
      maxAgeChunks,
      mediaType,
      chunkType,
      compesatedTs,
      estimatedDuration,
      seqId,
      metadata
    };

    const objectBytes = new TextEncoder().encode(JSON.stringify(chunkObject));

    uniWriter.write(objectBytes);

    const p = uniWriter.close();
   
   // addToInFlight(mediaType, p);
  } catch(err: any) {
    sendMessageToMain(WORKER_PREFIX, "error", "request: " + mediaType + "-" + seqId + ". Err: " + err.message);
  }
  return null;
}

export {};
