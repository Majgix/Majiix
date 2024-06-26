// Handles output formats and streams
import {
  MOQ_PARAMETER_ROLE_BOTH,
  MOQ_PARAMETER_ROLE_PUBLISHER,
  MOQ_PARAMETER_ROLE_SUBSCRIBER,
  Moqt,
  moqClose,
  moqCreate,
  moqCreateControlStream,
  moqParseSubscribe,
  moqSendAnnounce,
  moqSendObjectToWriter,
  moqSendSetup,
  moqSendSubscribeResponse,
  parseAnnounceResponse,
  parseSetupResponse,
} from "~/utils/moqt";
import { State } from "./utils";
import { LocPackager } from "~/packager/loc_packager";
console.log("Initiating muxer-sender...");
let workerState = State.Created;

interface ChunkData {
  mediaType: string;
  chunk: EncodedAudioChunk | EncodedVideoChunk;
  estimatedDuration: number;
  compensatedTs: number;
  seqId: number;
  metadata: EncodedAudioChunkMetadata | EncodedVideoChunkMetadata;
}

interface Track {
  namespace: string;
  name: string;
  authInfo: string;
  id: number;
  numSubscribers?: number;
  isHipri: boolean;
}

let tracks: Record<string, Track> = {};
let inFlightRequests: Record<string, Track[]> = {};

let moqPublisherState: Record<number, any> = {};

const moqt = moqCreate();
const abortController = new AbortController();

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

      let urlHostPortEp = "";

      if ("urlHostPort" in event.data.muxerSenderConfig) {
        urlHostPortEp = event.data.muxerSenderConfig.urlHostPort;
      }

      if ("moqTracks" in event.data.muxerSenderConfig) {
        tracks = event.data.muxerSenderConfig.moqTracks;
      }
      const errTrackStr = checkTrackData();
      if (errTrackStr !== "") {
        console.log("error", errTrackStr);
        return;
      }

      try {
        moqResetState();
        await moqClose(moqt);

        // const url = new URL(urlHostPortEp);
        // url.protocol = 'https';
        const urlString = `https://${urlHostPortEp}`;
        const url = new URL(urlString);

        moqt.wt = new WebTransport(url.href);
        moqt.wt.closed
          .then(() => {
            console.log("WebTransport session closed");
          })
          .catch((error) => {
            throw new Error(`WT error, closed transport ${error}`);
          });
        await moqt.wt.ready;
        await moqCreateControlStream(moqt);
        await moqCreatePublisherSession(moqt);

        inFlightRequests = initInflightReqData(tracks);

        workerState = State.Running;

        startSubscriptionsLoop(moqt.controlReader!, moqt.controlWriter!)
          .then((_) => {
            console.log("info: receiving subscription loop in control stream");
          })
          .catch((err) => {
            if (workerState !== State.Stopped) {
              throw new Error(
                `Error in the subscription loop in control stream. Err: ${JSON.stringify(
                  err,
                )}`,
              );
            } else {
              console.log(
                `Info: Exited receiving subscription loop in control stream. Err: ${JSON.stringify(
                  err,
                )}`,
              );
            }
          });
      } catch (err) {
        throw new Error(`initializing moq error: ${err}`);
      }

      //await createWebTransportSession(`https://${urlHostPort}:${urlPath}`);
      return;
  }

  if (workerState !== State.Running) {
    return;
  }

  const compensatedTs =
    event.data.compensatedTs === undefined || event.data.compensatedTs < 0
      ? 0
      : event.data.compensatedTs;

  const estimatedDuration =
    event.data.estimatedDuration === undefined ||
    event.data.estimatedDuration < 0
      ? event.data.chunk.duration
      : event.data.estimatedDuration;

  const seqId = event.data.seqId === undefined ? 0 : event.data.seqId;

  const chunkData = {
    mediaType: type,
    compensatedTs,
    estimatedDuration,
    seqId,
    chunk: event.data.chunk,
    metadata: event.data.metadata,
  };

  await sendChunkToTransport(chunkData);
});

async function startSubscriptionsLoop(
  controlReader: ReadableStream,
  controlWriter: WritableStream,
) {
  while (workerState === State.Running) {
    const subscribe = await moqParseSubscribe(controlReader);
    const track = getTrack(subscribe.namespace, subscribe.trackName);

    if (track) {
      if ("numSubscribers" in track) {
        track.numSubscribers!++;
      } else {
        track.numSubscribers = 1;
      }
    }

    await moqSendSubscribeResponse(
      controlWriter,
      subscribe.namespace,
      subscribe.trackName,
      track!.id,
      0,
    );
  }
}

async function sendChunkToTransport(chunkData: ChunkData) {
  if (chunkData == null) {
    return;
  }
  return createRequest(chunkData);
}

function createRequest(chunkData: ChunkData) {
  let packet = new LocPackager();
  const chunkDataBuffer = new Uint8Array(chunkData.chunk.byteLength);
  chunkData.chunk.copyTo(chunkDataBuffer);

  packet.SetData(
    chunkData.mediaType,
    chunkData.compensatedTs,
    chunkData.estimatedDuration,
    chunkData.chunk.type,
    chunkData.seqId,
    chunkData.metadata,
    chunkDataBuffer,
  );

  return createSendPromise(packet);
}

async function createSendPromise(packet: LocPackager) {
  if (moqt.wt === null) {
    throw new Error(`Request not send because transport is not open.`);
  }
  if (!(packet.GetData().mediaType in tracks)) {
    throw new Error(
      `Object mediaType NOT supported (no track found), received ${
        packet.GetData().mediaType
      }`,
    );
  }

  const trackInfo = tracks[packet.GetData().mediaType];

  if (!trackInfo) {
    throw new Error(`Track info not found`);
  }

  const trackId = trackInfo.id;

  if (!(trackId in moqPublisherState)) {
    if (packet.GetData().chunkType === "delta") {
      return {
        dropped: true,
        message: `Dropped chunk because first object can not be delta, data: ${packet.GetDataStr()}`,
      };
    }
    moqPublisherState[trackId] = createTrackState();
  }

  const sendOrder = moqCalculateSendOrder(packet);

  const unistream = await moqt.wt.createUnidirectionalStream();
  const uniWriter = unistream.getWriter();

  // Group sequence, Using it as a joining point
  if (packet.GetData().chunkType !== "delta") {
    moqPublisherState[trackId].currentGroupSeq++;
    moqPublisherState[trackId].currentObjectSeq = 0;
  }

  const groupSeq = moqPublisherState[trackId].currentGroupSeq;
  const objSeq = moqPublisherState[trackId].currentObjectSeq;

  moqSendObjectToWriter(
    uniWriter,
    trackId,
    groupSeq,
    objSeq,
    sendOrder,
    packet.ToBytes(),
  );

  moqPublisherState[trackId].currentObjectSeq++;

  const p = uniWriter.close();
  const pId = packet.GetData().pId;

  addToInflight(packet.GetData().mediaType, pId);

  p.finally(() => {
    removeFromInflight(packet.GetData().mediaType, packet.GetData().pId);
  });

  return p;
}

function addToInflight(mediaType: string, p: string) {
  const key = `${mediaType}_${p}`;

  if (key in inFlightRequests) {
    throw new Error(`Error: id already exists in inFlight`);
  } else {
    inFlightRequests[key]?.push({ id: p } as unknown as Track);
  }
}

function removeFromInflight(mediaType: string, id: string) {
  const key = `${mediaType}_${id}`;

  if (key in inFlightRequests) {
    delete inFlightRequests[key];
  }
}

function initInflightReqData(tracks: Record<string, Track>) {
  const ret: Record<string, Track[]> = {};
  for (const [trackType, track] of Object.entries(tracks)) {
    ret[trackType] = [track];
  }
  return ret;
}

// MOQT

async function moqCreatePublisherSession(moqt: Moqt) {
  // Setup
  await moqSendSetup(moqt.controlWriter!, MOQ_PARAMETER_ROLE_PUBLISHER);
  const setupResponse = await parseSetupResponse(moqt.controlReader!);
  console.log(`Received setup response: ${JSON.stringify(setupResponse)}`);
  if (
    setupResponse.parameters.role !== MOQ_PARAMETER_ROLE_SUBSCRIBER &&
    setupResponse.parameters.role !== MOQ_PARAMETER_ROLE_BOTH
  ) {
    throw new Error(`role not supported. 
      Supported  ${MOQ_PARAMETER_ROLE_SUBSCRIBER}, 
      got from server ${JSON.stringify(setupResponse.parameters.role)}`);
  }

  // Announce
  const announceNamespaces: string[] = [];
  for (const [trackType, trackData] of Object.entries(tracks)) {
    if (!announceNamespaces.includes(trackData.namespace)) {
      await moqSendAnnounce(
        moqt.controlWriter!,
        trackData.namespace,
        trackData.authInfo,
      );
      const announcResp = await parseAnnounceResponse(moqt.controlReader!);

      console.log(
        `Received ANNOUNCE response for ${trackData.id}-${trackType}-${
          trackData.namespace
        }: ${JSON.stringify(announcResp)}`,
      );

      if (trackData.namespace !== announcResp.namespace) {
        throw new Error(
          `expecting namespace ${trackData.namespace}, got ${JSON.stringify(
            announcResp,
          )}`,
        );
      }
      announceNamespaces.push(trackData.namespace);
    }
  }
}

function checkTrackData() {
  if (Object.entries(tracks).length <= 0) {
    return "Number of Track Ids to announce must be > 0";
  }
  for (const [, track] of Object.entries(tracks)) {
    if (
      !("namespace" in track) ||
      !("name" in track) ||
      !("authInfo" in track)
    ) {
      return "Track malformed, needs to contain namespace, name, and authInfo";
    }
  }
  return "";
}

function moqResetState() {
  moqPublisherState = {};
}

function moqCalculateSendOrder(packet: LocPackager) {
  const data = packet.GetData();

  let ret = data.seqId;

  if (typeof ret === "undefined" || ret < 0) {
    // Send now
    ret = Number.MAX_SAFE_INTEGER;
  } else {
    const track = tracks[data.mediaType];

    if (!track) {
      throw new Error(`Track with media type '${data.mediaType}' not found.`);
    }

    if (track.isHipri) {
      ret = Math.floor(ret + Number.MAX_SAFE_INTEGER / 2);
    }
  }

  return ret;
}

function createTrackState() {
  return {
    currentGroupSeq: 0,
    currentObjectSeq: 0,
  };
}

function getTrack(namespace: string, trackName: string) {
  for (const [, trackData] of Object.entries(tracks)) {
    if (trackData.namespace === namespace && trackData.name === trackName) {
      return trackData;
    }
  }
  return null;
}

function getAllInflightRequestsArray() {
  let ret: Track[] = [];
  for (const trackType in tracks) {
    if (inFlightRequests.hasOwnProperty(trackType)) {
      const track = inFlightRequests[trackType];
      if (track !== undefined) {
        ret = ret.concat(track);
      }
    }
  }
  return ret;
}

export {};
