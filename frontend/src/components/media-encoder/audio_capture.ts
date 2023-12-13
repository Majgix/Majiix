import "./utils";
const WORKER_PREFIX = "[AUDIO-CAPTURE]";

let stopped = false;
let mainLoopInterval: any | undefined = undefined;
let isMainLoopInExecution = false;

async function mainLoop(frameReader: ReadableStreamDefaultReader<AudioData>): Promise<boolean> {
    if(isMainLoopInExecution){
        return false;
    }
    isMainLoopInExecution = true;

    try {
        if (stopped === true){
            if (mainLoopInterval != undefined){
              clearInterval(mainLoopInterval);
              mainLoopInterval = undefined;
            }
            sendMessageToMain(WORKER_PREFIX, "info", "exited");
            isMainLoopInExecution = false;
            return false;
        }

        const {done, value} = await frameReader.read();

        if (done) {
            sendMessageToMain(WORKER_PREFIX, "info", "Stream is done");
            await frameReader.cancel("ended");
        } else {
            const audioFrame: AudioData = value;
            sendMessageToMain(WORKER_PREFIX, "debug", `
                Read frame format: ${audioFrame.format}, 
                Timestamp: ${audioFrame.timestamp}(${audioFrame.duration}), 
                Samplerate: ${audioFrame.sampleRate},
                Frames: ${audioFrame.numberOfFrames},
                Channels: ${audioFrame.numberOfChannels},`
            );

            //Clone the audio data before transferring
            const cloneFrame = audioFrame.clone();
            self.postMessage({
                type: "audioframe",
                time: Date.now(),
                data: cloneFrame,
            });
            audioFrame.close();

            isMainLoopInExecution = false;
            return true;
        }
    } catch (error) {
        console.error(error);
    } finally {
        isMainLoopInExecution = false;
    }
    return false;
};

self.addEventListener('message',async (event: MessageEvent) => {
    const {type, data} =  event.data;

    switch (type) {
        case "stop":
            stopped = true;
            break;
        case "stream":
            if (mainLoopInterval !== undefined) {
                sendMessageToMain(WORKER_PREFIX, "error", "Main loop already running");
                return
            }

            const audioFrameStream = data.audioStream as ReadableStream<AudioData>;
            const audioFrameReader = audioFrameStream.getReader();

            sendMessageToMain(WORKER_PREFIX, "info", "Received streams from main page; starting worker loop");

            mainLoopInterval = setInterval(() => mainLoop(audioFrameReader), 1);
            break;
    }
})
