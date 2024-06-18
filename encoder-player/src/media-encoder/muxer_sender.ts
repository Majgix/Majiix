// Handles output formats and streams
import { MOQ_PARAMETER_ROLE_BOTH, MOQ_PARAMETER_ROLE_PUBLISHER, MOQ_PARAMETER_ROLE_SUBSCRIBER, Moqt, moqClose, moqCreate, moqCreateControlStream, moqParseSubscribe, moqSendAnnounce, moqSendObjectToWriter, moqSendSetup, moqSendSubscribeResponse, parseAnnounceResponse, parseSetupResponse } from "~/utils/moqt";
import { State } from "./utils";
import { LocPackager } from "~/packager/loc_packager";
console.log("Initiating muxer-sender...");
let workerState = State.Created;

// Default values
let inFlightRequests = {
  audio: {},
  video: {},
};

// let urlHostPort: string;
// let urlPath: string;

const abortController = new AbortController();

// WebTransport data
//let wTransport: WebTransport | null = null;

interface ChunkData {
  mediaType: string;
  chunk: EncodedAudioChunk | EncodedVideoChunk;
  estimatedDuration: number;
  compensatedTs: number;
  seqId: number;
  metadata: EncodedAudioChunkMetadata | EncodedVideoChunkMetadata;
}

let tracks = {};

let moqPublisherState = {}

const moqt = moqCreate();

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
      } catch (err) {
        console.error(err);
      } finally {
        await moqClose(moqt);
      }
      return;
    case "muxersenderini":
      if (workerState !== State.Instatiated) {
        console.log("error, received init message in wrong state");
        return;
      }

      let urlHostPortEp = '';

      if ('urlHostPort' in event.data.muxerSenderConfig) {
        urlHostPortEp = event.data.muxerSenderConfig.urlHostPort;
      }

      if ('moqTracks' in event.data.muxerSenderConfig) {
        tracks = event.data.muxerSenderConfig.moqTracks;
      }

      try {
        moqResetState();
        await moqClose(moqt);

        const url = new URL(urlHostPortEp);
        url.protocol = 'https';

        moqt.wt = new WebTransport(url.href);
        moqt.wt.closed
          .then(() => {
            console.log("WebTransport session closed");
          })
          .catch(error => {
            throw new Error(`WT error, closed transport ${error}`);
          });
        await moqt.wt.ready;
        await moqCreateControlStream(moqt);
        await moqCreatePublisherSession(moqt);

        inFlightRequests = initInflightReqData(tracks);

        workerState = State.Running;

        await startSubscriptionsLoop(moqt.controlReader, moqt.controlWriter);
      } catch(err) {
        throw new Error(`initializing moq error: ${err}`);
      }

      //await createWebTransportSession(`https://${urlHostPort}:${urlPath}`);
      return;
  }

  if (workerState !== State.Running) {
    return;
  }

  const compensatedTs = (event.data.compensatedTs === undefined || event.data.compensatedTs < 0) ? 0 : event.data.compensatedTs;

  const estimatedDuration = (event.data.estimatedDuration === undefined || 
    event.data.estimatedDuration < 0) ? 
    event.data.chunk.duration : event.data.estimatedDuration;

  const seqId = (event.data.seqId === undefined) ? 0 : event.data.seqId;

  const chunkData = { mediaType: type, compensatedTs, estimatedDuration, seqId, chunk: event.data.chunk, metadata: event.data.metadata };

  await sendChunkToTransport(chunkData, inFlightRequests[type], tracks[type]);
});

async function startSubscriptionsLoop(controlReader: ReadableStream, controlWriter: WritableStream) {
  while (workerState === State.Running) {
    const subscribe = await moqParseSubscribe(controlReader);
    const track = getTrack(subscribe.namespace, subscribe.trackName);

    if('numSubscribers' in track) {
      track.numSubscribers++;
    } else {
      track.numSubscribers = 1;
    }
    await moqSendSubscribeResponse(controlWriter, subscribe.namespace, subscribe.trackName, track.id, 0);
  }
}


async function sendChunkToTransport(chunkData: ChunkData, inFlightRequests: inFlightRequests) {
  if (chunkData == null) {
    return;
  }
  return createRequest(chunkData);
}


function createRequest(chunkData: ChunkData) {

  let packet = new LocPackager();
  const chunkDataBuffer = new Uint8Array(chunkData.chunk.byteLength);
  chunkData.chunk.copyTo(chunkDataBuffer);

  packet.SetData(chunkData.mediaType, chunkData.compensatedTs, chunkData.estimatedDuration, chunkData.chunk.type, chunkData.seqId, chunkData.metadata, chunkDataBuffer);

  return createSendPromise(packet);

}

async function createSendPromise(packet: LocPackager) {
  if (moqt.wt === null) {
    throw new Error(`Request not send because transport is not open.`);
  }
  if (!(packet.GetData().mediaType in tracks)) {
    throw new Error (`Object mediaType NOT supported (no track found), received ${packet.GetData().mediaType}`);
  }
  const trackId = tracks[packet.GetData().mediaType].id;

  if (!(trackId in moqPublisherState)) {
    if (packet.GetData().chunkType === 'delta') {
      return { dropped: true, message: `Dropped chunk because first object can not be delta, data: ${packet.GetDataStr()}` };
    }
    moqPublisherState[trackId] = createTrackState()
  }

  const sendOrder = moqCalculateSendOrder(packet);

  const unistream = await moqt.wt.createUnidirectionalStream({ options: {sendOrder } });
  const uniWriter = unistream.getWriter();

  // Group sequence, Using it as a joining point
  if (packet.GetData().chunkType !== 'delta') {
    moqPublisherState[trackId].currentGroupSeq++;
    moqPublisherState[trackId].currentObjectSeq = 0;
  }

  const groupSeq = moqPublisherState[trackId].currentGroupSeq;
  const objSeq = moqPublisherState[trackId].currentObjectSeq;

  moqSendObjectToWriter(uniWriter, trackId, groupSeq, sendOrder, packet.ToBytes());

  moqPublisherState[trackId].currentObjectSeq++;

  const p = uniWriter.close();
  p.id = packet.GetData().pId;

  addToInflight(packet.GetData().mediaType, p);

  p.finally(() => {
    removeFromInflight(packet.GetData().mediaType, packet.GetData().pId);
  });

  return p;
}

function addToInflight(mediaType: string, p: WritableStream) {
  if (p.id in inFlightRequests[mediaType]) {
    throw new Error(`Error: id already exists in Inflight`);
  } else {
    inFlightRequests[mediaType][p.id] = p;
  }
}

function removeFromInflight(mediaType: string, id: number) {
  if (id in inFlightRequests[mediaType]) {
    delete inFlightRequests[mediaType][id];
  }
}

// MOQT

async function moqCreatePublisherSession(moqt: Moqt) {
  // Setup
  await moqSendSetup(moqt.controlWriter, MOQ_PARAMETER_ROLE_PUBLISHER);
  const setupResponse = await parseSetupResponse(moqt.controlReader);
  console.log(`Received setup response: ${JSON.stringify(setupResponse)}`);
  if (setupResponse.parameters.role !== MOQ_PARAMETER_ROLE_SUBSCRIBER && setupResponse.parameters.role !== MOQ_PARAMETER_ROLE_BOTH){
    throw new Error(`role not supported. 
      Supported  ${MOQ_PARAMETER_ROLE_SUBSCRIBER}, 
      got from server ${JSON.stringify(setupResponse.parameters.role)}`
    );
  }

  // Announce
  const announceNamespaces = [];
  for (const [trackType, trackData] of Object.entries(tracks)) {
    if (!announceNamespaces.includes(trackData.namespace)) {
      await moqSendAnnounce(moqt.controlWriter, trackData.namespace, trackData.authInfo);
      const announcResp = await parseAnnounceResponse(moqt.controlReader);
      if (trackData.namespace !== announcResp.namespace) {
        throw new Error (`expecting namespace ${trackData.namespace}, got ${JSON.stringify(announcResp)}`);
      }
      announceNamespaces.push(trackData.namespace);
    }
  }
}

function checkTrackData() {
  if (Object.entries(tracks).length <= 0) {
    return 'Number of Track Ids to announce must be > 0';
  }
  for (const [, track] of Object.entries(tracks)) {
    if (!('namespace' in track) || !('name' in track) || !('authInfo' in track)) {
          return 'Track malformed, needs to contain namespace, name, and authInfo'
    }
  }
  return '';
}

function initInflightReqData (tracks: Track) {
  const ret = {}
  for (const [trackType] of Object.entries(tracks)) {
    ret[trackType] = {}
  }
  return ret
}

function moqResetState () {
  moqPublisherState = {}
}

function moqCalculateSendOrder (packet: LocPackager) {
  // Prioritize:
  // Audio over video
  // New over old

  let ret = packet.GetData().seqId
  if (ret < 0) {
    // Send now
    ret = Number.MAX_SAFE_INTEGER
  } else {
    if (tracks[packet.GetData().mediaType].isHipri) {
      ret = Math.floor(ret + Number.MAX_SAFE_INTEGER / 2)
    }
  }
  return ret
}

function createTrackState () {
  return {
    currentGroupSeq: 0,
    currentObjectSeq: 0
  }
}

function getTrack (namespace: string, trackName: string) {
  for (const [, trackData] of Object.entries(tracks)) {
    if (trackData.namespace === namespace && trackData.name === trackName) {
      return trackData
    }
  }
  return null
}

function getAllInflightRequestsArray() {
  const arrAudio = Object.values(inFlightRequests.audio);
  const arrVideo = Object.values(inFlightRequests.video);

  return arrAudio.concat(arrVideo);
}


export {};
