import { createSignal } from "solid-js";
import "./Render.css";
import {
  videoEncoderConfig,
  audioEncoderConfig,
  muxerSenderConfig,
} from "./media-encoder/configs";

export default function Render() {
  const [mediaElement, setMediaElement] = createSignal<HTMLVideoElement | null>(
    null,
  );

  // Declare Workers
  let videoCaptureWorker: Worker;
  let audioCaptureWorker: Worker;
  let videoEncoderWorker: Worker;
  let audioEncoderWorker: Worker;
  let muxerSenderWorker: Worker;

  const createWorkers = () => {
    // Create new web workers for A/V frames capture
    videoCaptureWorker = new Worker(
      new URL("./media-encoder/video_capture.ts", import.meta.url),
      {
        type: "module",
      },
    );
    audioCaptureWorker = new Worker(
      new URL("./media-encoder/audio_capture.ts", import.meta.url),
      {
        type: "module",
      },
    );

    //create new workers for A/V frames encode
    videoEncoderWorker = new Worker(
      new URL("./media-encoder/video_encoder.ts", import.meta.url),
      {
        type: "module",
      },
    );
    audioEncoderWorker = new Worker(
      new URL("./media-encoder/audio_encoder.ts", import.meta.url),
      {
        type: "module",
      },
    );

    //create send worker
    muxerSenderWorker = new Worker(
      new URL("./media-encoder/muxer_sender.ts", import.meta.url),
      {
        type: "module",
      },
    );
  };

  function processWorkerMessage(e: MessageEvent) {
    // Send video frames to video encoder
    if (e.data.type === "videoframe") {
      const videoFrame = e.data.data;

      videoEncoderWorker?.postMessage(
        { type: "videoframe", videoframe: videoFrame },
        [videoFrame],
      );
      // Send to audio encoder if audioframe
    } else if (e.data.type === "audioframe") {
      const audioFrame = e.data.data;

      audioEncoderWorker?.postMessage({
        type: "audioframe",
        audioframe: audioFrame,
      });

      // Chunks are sent to MuxerSender for muxing and forwarding to relay
    } else if (e.data.type === "videochunk") {
      const chunk = e.data.chunk;

      muxerSenderWorker?.postMessage({ type: "videochunk", chunk: chunk });
    } else if (e.data.type === "audiochunk") {
      const chunk = e.data.chunk;

      muxerSenderWorker?.postMessage({ type: "audiochunk", chunk: chunk });
    }
  }

  const startStream = async () => {
    console.log("starting capture");
    createWorkers();

    await navigator.mediaDevices
      .getUserMedia({
        video: true,
        audio: true,
      })
      .then((mediaStream) => {
        // Create a video element and connect it to a webcam
        const v_element = document.createElement("video");
        v_element.muted = true;
        v_element.srcObject = mediaStream;
        v_element.play();
        setMediaElement(v_element);

        videoCaptureWorker?.addEventListener("message", function (e) {
          processWorkerMessage(e);
        });
        audioCaptureWorker?.addEventListener("message", function (e) {
          processWorkerMessage(e);
        });
        videoEncoderWorker?.addEventListener("message", function (e) {
          processWorkerMessage(e);
        });
        audioEncoderWorker?.addEventListener("message", function (e) {
          processWorkerMessage(e);
        });
        muxerSenderWorker?.addEventListener("message", function (e) {
          processWorkerMessage(e);
        });

        // Create media stream tracks
        const videoTrack = mediaStream.getVideoTracks()[0];
        const audioTrack = mediaStream.getAudioTracks()[0];

        // Initialize muxer-sender
        muxerSenderWorker?.postMessage({
          type: "muxersenderini",
          muxerSenderConfig: muxerSenderConfig,
        });

        if (videoTrack) {
          const trackProcessor = new MediaStreamTrackProcessor({
            track: videoTrack,
          });

          // Read frames flowing through the MediaStreamTrack
          const videoFrameStream = trackProcessor.readable;

          // Initialize video encoder
          videoEncoderWorker?.postMessage({
            type: "vencoderini",
            encoderConfig: videoEncoderConfig.encoderConfig,
            encoderMaxQueSize: videoEncoderConfig.encoderMaxQueSize,
            keyframeEvery: videoEncoderConfig.keyframeEvery,
          });

          // Transfer the readable stream to the worker
          videoCaptureWorker?.postMessage(
            {
              type: "videostream",
              vstream: videoFrameStream,
            },
            [videoFrameStream],
          );
        }
        if (audioTrack) {
          // Generate a stream of audio frames
          const trackProcessor = new MediaStreamTrackProcessor({
            track: audioTrack,
          });

          // Build a readable stream
          const audioFrameStream = trackProcessor.readable;

          //Initialize audio encoder
          audioEncoderWorker?.postMessage({
            type: "aencoderini",
            encoderConfig: audioEncoderConfig.encoderConfig,
            encoderMaxQueSize: audioEncoderConfig.encoderMaxQueSize,
          });

          // Transfer readable audio stream to the worker
          audioCaptureWorker?.postMessage(
            {
              type: "audiostream",
              astream: audioFrameStream,
            },
            [audioFrameStream],
          );
        } else {
          console.error("No audio or video track found!");
        }
      })
      .catch((err) => {
        console.error(err);
      });
  };
  return (
    <div>
      <button class="start-session-button" onClick={startStream}>
        Start a session
      </button>
      {mediaElement()}
    </div>
  );
}
