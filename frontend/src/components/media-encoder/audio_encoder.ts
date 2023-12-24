import "./utils";
const WORKER_PREFIX = "[AUDIO-ENCODER]";
const INSERT_METADATA_EVERY_AUDIO_FRAMES = 20;

let frame_delivered_counter = 0;
let chunk_delivered_counter = 0;
let workerState = State.Created;

//Default values
let encoderMaxQueSize = 5;

//last received metadata
let lastAudioMetadata: EncodedAudioChunkMetadata | undefined;

let audioEncoder: AudioEncoder | null = null;

//Encoder
const initAudioEncoder = {
    output: handleAudioChunk,
    error: (e: Error) => {
        if (workerState === State.Created) {
            console.error(e.message);
        } else {
            sendMessageToMain(WORKER_PREFIX, "error", e.message);
        }
    }
};

function handleAudioChunk(chunk: EncodedAudioChunk, metadata: EncodedAudioChunkMetadata){
    let insertMetadata: EncodedAudioChunkMetadata | undefined;
    if(isMetadataValid(metadata)) {
        lastAudioMetadata = metadata;
        insertMetadata = lastAudioMetadata;
    } else {
        //Inject last received metadata following video IDR behaviour
        if (chunk_delivered_counter % INSERT_METADATA_EVERY_AUDIO_FRAMES === 0) {
            insertMetadata = lastAudioMetadata;
        }
    }

    const message = {
        type: "audiochunk",
        seqId: chunk_delivered_counter ++, 
        chunk: chunk,
        metadata: serializeMetadata(insertMetadata),
    };

    sendMessageToMain(WORKER_PREFIX, "info", `
        Chunk created. sId: ${message.seqId}
        Timestamp: ${chunk.timestamp},
        Duration: ${chunk.duration},
        type: ${chunk.type},
        size:  ${chunk.byteLength}
    `);


    self.postMessage(message);
}

self.addEventListener("message", async (event: MessageEvent) => {
    const message = event.data;
    const type = event.data.type;

    if (workerState == State.Created) {
        workerState = State.Instatiated;
    }

    if (workerState === State.Stopped) {
        sendMessageToMain(WORKER_PREFIX, "info", "Encoder stopped");
        return;
    }

    switch (type) {
        case "stop":
            workerState = State.Stopped;
            await audioEncoder?.flush();

            audioEncoder?.close();
            lastAudioMetadata = undefined;
            return;
        case "aencoderini":
            const encoderConfig: AudioEncoderConfig = message.encoderConfig;

            audioEncoder = new AudioEncoder(initAudioEncoder);
            audioEncoder.configure(encoderConfig);

            if ("encoderMaxQueSize" in message) {
                encoderMaxQueSize = message.encoderMaxQueSize;
            }

            sendMessageToMain(WORKER_PREFIX, "info", "Encoder initialized");
            return;
        case "audioframe":
            const audioFrame: AudioData = event.data.audioframe;

            if (audioEncoder!.encodeQueueSize > encoderMaxQueSize) {
                // Too many frames in encoder, drop this frame
                sendMessageToMain(WORKER_PREFIX, "dropped", { time: Date.now(), timestamp: audioFrame.timestamp, message: "Dropped encodeing audio frame" });
                audioFrame.close();
            } else {
                sendMessageToMain(WORKER_PREFIX, "debug", "Send to encode frame timestamp: " + audioFrame.timestamp + ". Counter: " + frame_delivered_counter++);

                audioEncoder?.encode(audioFrame);
                audioFrame.close();
            }
            return;
    }
});
