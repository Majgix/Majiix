import { createSignal } from "solid-js";
import "./Render.css";

export default function Render() {
  const [mediaElement, setMediaElement] = createSignal<HTMLVideoElement | null>(
    null,
  );

  //Current Workers
  let videoStreamWorker: Worker | null;
  let audioStreamWorker: Worker | null;
  let videoEncoderWorker: Worker | null;
  let audioEncoderWorker: Worker | null;
  let muxerSenderWorker: Worker | null;

  const createWorkers = () => {
        //create new web workers for A/V frames captureeeeeeeeeeeeee
      videoStreamWorker = new Worker("./media-encoder/video_capture.ts");
      audioStreamWorker = new Worker("./media-encoder/audio_capture.ts");

      //create new workers for A/V frames encode
      videoEncoderWorker = new Worker("./video_encoder.ts");
      audioEncoderWorker = new Worker("./audio_encoder.ts");

      //create send worker
      muxerSenderWorker = new Worker("./muxer_sender.ts");

  }

  const startStream = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
      }).then(mediaStream => {
        //create a video element and connect it to a webcam
        const v_element = document.createElement("video");
        v_element.srcObject = mediaStream;
        v_element.play();

        setMediaElement(v_element);

        //Create the media tracks
        const videoTrack = mediaStream.getVideoTracks()[0];
        const audioTrack = mediaStream.getAudioTracks()[0];

        // Initialize muxer-sender
        muxerSenderWorker?.postMessage({
          type: 'muxersenderini',
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
            keyframeEver: videoEncoderConfig.keyframeEvery
          });

          // Transfer the readable stream to the worker
          videoStreamWorker?.postMessage({
            type: "stream",
            video_stream: VideoFrame
          });

          videoStreamWorker?.postMessage({
            type: "stream",
            vstream: videoFrameStream
          },
            [videoFrameStream] 
          )
        
          //Transfer the readable streams to the worker
          videoStreamWorker?.postMessage({ type: 'stream', vstream: videoFrameStream }, [videoFrameStream]);

        } else if(audioTrack) {
          const trackProcessor = new MediaStreamTrackProcessor({
            track: audioTrack,
          });
          
          //reader
          const audioFrameStream = trackProcessor.readable;

          //Initialize audio encoder
          audioEncoderWorker?.postMessage({
            type: "aencodeini",
            encoderConfig: audioEncoderConfig.encoderConfig,
            encoderMaxQueSize: audioEncoderConfig.encoderMaxQueSize,
          });

          //transfer readable audio stream to the worker
          audioStreamWorker?.postMessage({ type: 'stream', astream: audioFrameStream }, [audioFrameStream]);
        }
        else {
          console.error("No audio or video track found!");
        }
      });
  };
  return (
    <div>
      <button class="increment" onClick={startStream}>Start Capture</button>
      {mediaElement()}
    </div>
  );
}
