import "./utils";
import { State, sendMessageToMain, serializeMetadata } from "./utils";
const WORKER_PREFIX = "[VIDEO-ENCODER]";

let frame_delivered_counter = 0;
let chunk_delivered_counter = 0;

let workerState = State.Created;

// Default values
let encoderMaxQueueSize = 5;
let keyframeEvery = 60;
let insertNextKeyframe = false;

//Encoder
const initVideoEncoder: VideoEncoderInit = {
    output: handleVideoChunk,
    error: (e: Error) => {
        if (workerState === State.Created) {
            console.error(e.message);
        } else {
            sendMessageToMain(WORKER_PREFIX, "error", e.message);
        }
    }
};

let videoEncoder: VideoEncoder | null = null;

function handleVideoChunk(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) {
    const message = {
        type: "videochunk",
        seqId: chunk_delivered_counter ++,
        chunk: chunk,
        metadata: serializeMetadata(metadata),
    };

    sendMessageToMain(WORKER_PREFIX, "info", `
        Chunk created. sId: ${message.seqId}
        Timestamp: ${chunk.timestamp},
        Duration: ${chunk.duration},
        type: ${chunk.type},
        size: ${chunk.byteLength},
    `);

    self.postMessage(message);
}

self.addEventListener("message", async (event: MessageEvent) => {
    if (workerState == State.Created) {
        workerState = State.Instatiated;
    }

     if (workerState === State.Stopped) {
        sendMessageToMain(WORKER_PREFIX, "info", "Encoder is stopped and doesn't accept messages");
        return;
    }

    //const message = event.data;
    const type = event.data.type;

    switch(type) {
        case "stop":
            workerState = State.Stopped;
            await videoEncoder?.flush();

            videoEncoder?.close();
            
            workerState = State.Stopped;
            return;
        case "vencoderini":
            const encoderConfig = event.data.encoderConfig;

            videoEncoder = new VideoEncoder(initVideoEncoder);

            videoEncoder.configure(encoderConfig);

            if ('encoderMaxQueSize' in event.data) {
                encoderMaxQueueSize = event.data.encoderMaxQueueSize;
            }

            if ('keyframeEvery' in event.data) {
                keyframeEvery = event.data.keyframeEvery;
            }

            sendMessageToMain(WORKER_PREFIX, "info", "Encoder initialized");

            workerState = State.Running;
            return;
        case "videoframe":
            const videoFrame: VideoFrame = event.data.videoFrame;

            if (videoEncoder!.encodeQueueSize > encoderMaxQueueSize) {
                sendMessageToMain(WORKER_PREFIX, "dropped", {clkms: Date.now(), timestamp: videoFrame.timestamp, msg: "Dropped encoding video frame"});
                videoFrame.close();
                insertNextKeyframe = true;
            } else {
                const frame_num = frame_delivered_counter++;
                const insert_keyframe = (frame_num % keyframeEvery) == 0 || (insertNextKeyframe == true);
                videoEncoder?.encode(videoFrame, { keyFrame: insert_keyframe });
                videoFrame.close();
                sendMessageToMain(WORKER_PREFIX, "debug", "Encoded frame: " + frame_num + ", key: " + insert_keyframe);
                insertNextKeyframe = false;
            }
            return;
        default:
            sendMessageToMain(WORKER_PREFIX, "error", "Invalid message received");
            return;
    }
});
