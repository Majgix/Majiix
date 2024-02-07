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

  //Current Workers
  let videoCaptureWorker: Worker | null;
  let audioCaptureWorker: Worker | null;
  let videoEncoderWorker: Worker | null;
  let audioEncoderWorker: Worker | null;
  let muxerSenderWorker: Worker | null;

  const createWorkers = () => {
    //create new web workers for A/V frames capture
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
    if (e.data.type === "videoframe") {
      const videoFrame = e.data.data;

      videoEncoderWorker?.postMessage(
        { type: "videoframe", videoframe: videoFrame },
        [videoFrame],
      );
    } else if (e.data.type === "audioframe") {
      const audioFrame = e.data.data;

      audioEncoderWorker?.postMessage({
        type: "audioframe",
        audioframe: audioFrame,
      });

      // Chunks
    } else if (e.data.type === "videochunk") {
      const chunk = e.data.chunk;

      muxerSenderWorker?.postMessage({ type: "videochunk", chunk: chunk });
    } else if (e.data.type === "audiochunk") {
      const chunk = e.data.chunk;

      muxerSenderWorker?.postMessage({ type: "audiochunk", chunk: chunk });
    }
  }

  const startStream = async () => {
    createWorkers();

    await navigator.mediaDevices
      .getUserMedia({
        video: true,
        audio: true,
      })
      .then((mediaStream) => {
        //create a video element and connect it to a webcam
        const v_element = document.createElement("video");
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
        //Create the media tracks
        const videoTrack = mediaStream.getVideoTracks()[0];
        const audioTrack = mediaStream.getAudioTracks()[0];

        // Initialize muxer-sender
        muxerSenderWorker?.postMessage({
          type: "muxersenderini",
          muxerSenderConfig: muxerSenderConfig,
        });

        //create a MediaStreamTrackProcessor, which
        //breaks media tracks into individual frames
        if (videoTrack) {
          const trackProcessor = new MediaStreamTrackProcessor({
            track: videoTrack,
          });

          //read frames flowing through the MediaStreamTrack
          const videoFrameStream = trackProcessor.readable;

          // Initialize video encoder
          videoEncoderWorker?.postMessage({
            type: "vencoderini",
            encoderConfig: videoEncoderConfig.encoderConfig,
            encoderMaxQueSize: videoEncoderConfig.encoderMaxQueSize,
            keyframeEver: videoEncoderConfig.keyframeEvery,
          });

          // Transfer the readable stream to the worker
          videoCaptureWorker?.postMessage(
            {
              type: "videostream",
              vstream: videoFrameStream,
            },
            [videoFrameStream],
          );
        } else if (audioTrack) {
          const trackProcessor = new MediaStreamTrackProcessor({
            track: audioTrack,
          });

          //reader
          const audioFrameStream = trackProcessor.readable;

          //Initialize audio encoder
          audioEncoderWorker?.postMessage({
            type: "aencoderini",
            encoderConfig: audioEncoderConfig.encoderConfig,
            encoderMaxQueSize: audioEncoderConfig.encoderMaxQueSize,
          });

          //transfer readable audio stream to the worker
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
      <button class="increment" onClick={startStream}>
        Start a session
      </button>
      {mediaElement()}
    </div>
  );
}
