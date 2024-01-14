import "./utils";
import { State } from "./utils";

let frame_delivered_counter = 0;
let workerState = State.Created;

// Default values
let encoderMaxQueueSize = 5;
let keyframeEvery = 60;
let insertNextKeyframe = false;

//Encoder
const initVideoEncoder: VideoEncoderInit = {
  output: handleVideoChunk,
  error: (e: Error) => {
    console.error(e.message);
  },
};

let videoEncoder: VideoEncoder | null = null;

function handleVideoChunk(chunk: EncodedVideoChunk) {
  const message = {
    type: "videochunk",
    chunk: chunk,
  };

  self.postMessage(message);
}

self.addEventListener("message", async (event: MessageEvent) => {
  if (workerState == State.Created) {
    workerState = State.Instatiated;
  }

  if (workerState === State.Stopped) {
    return;
  }

  //const message = event.data;
  const type = event.data.type;

  switch (type) {
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

      workerState = State.Running;
      return;
    case "videoframe":
      const videoFrame: VideoFrame = event.data.videoFrame;

      if (videoEncoder!.encodeQueueSize > encoderMaxQueueSize) {
        videoFrame.close();
        insertNextKeyframe = true;
      } else {
        const frame_num = frame_delivered_counter++;
        const insert_keyframe =
          frame_num % keyframeEvery == 0 || insertNextKeyframe == true;
        videoEncoder?.encode(videoFrame, { keyFrame: insert_keyframe });
        videoFrame.close();
        insertNextKeyframe = false;
      }
      return;
    default:
      return;
  }
});
