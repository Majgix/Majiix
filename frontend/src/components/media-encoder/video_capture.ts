import "./utils";
const WORKER_PREFIX = "[VIDEO-CAPTURE]";

let stopped = false;
let mainLoopInterval: any | undefined = undefined;
let isMainLoopInExecution = false;

let timeCheck: any | undefined = undefined;
let estimatedFps = 0; //frame rate per second

async function mainLoop (frameReader: ReadableStreamDefaultReader<VideoFrame>): Promise<boolean>{
    if (isMainLoopInExecution) {
        return false;
    }

    isMainLoopInExecution = true;

    try {
        if (stopped) {
            if (mainLoopInterval !== undefined) {
                clearInterval(mainLoopInterval);
                mainLoopInterval = undefined;
            }
            sendMessageToMain(WORKER_PREFIX, "info",  "exited");
            isMainLoopInExecution = false;
            return false;
        }

        frameReader.read().then((result: ReadableStreamReadResult<VideoFrame>) => {
            if(result.done) {
                sendMessageToMain(WORKER_PREFIX, "info", "Stream is done!");
                frameReader.cancel("ended").then(() => false);
            } else {
                const videoFrame = result.value

                sendMessageToMain(WORKER_PREFIX, 
                    "debug", `
                    Read frame format: ${videoFrame.format},
                    Timestamp: ${videoFrame.timestamp}(${videoFrame.duration}),`
                );

                //Send frame to process 
                self.postMessage({
                    type: "videoframe",
                    time: Date.now(),
                    data: videoFrame
                });

                estimatedFps++;
                if (timeCheck === undefined) {
                    timeCheck = Date.now();
                }

                const nowMs = Date.now();
                if (nowMs >= timeCheck + 1000) {
                    sendMessageToMain(WORKER_PREFIX, "debug", `estimated fps last sec: ${estimatedFps}`);
                    estimatedFps = 0;
                    timeCheck = nowMs;
                }

                isMainLoopInExecution = false;
                return true;
            }
            return false;
        });
    } catch (error) {
        console.error(error);
        isMainLoopInExecution = false;
    }
    return false;
}

self.addEventListener('message', async (event: MessageEvent) => {
    const { type, data } = event.data;

    switch (type) {
        case "stop":
            stopped = true;
            break;
        case "stream":
            if (mainLoopInterval !== undefined) {
                sendMessageToMain(WORKER_PREFIX, "error", "Loop already running");
                return;
            }

            const videoFrameStream = data.videoStream as ReadableStream<VideoFrame>;
            const videoFrameReader = videoFrameStream.getReader();

            sendMessageToMain(WORKER_PREFIX, "info", "Received streams from main page, starting worker loop");

            mainLoopInterval = setInterval(() => mainLoop(videoFrameReader), 1);
            break;
        default:
            sendMessageToMain(WORKER_PREFIX, "error", "Invalid message received.");
            break;
    }
});
