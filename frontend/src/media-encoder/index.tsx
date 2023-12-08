//Current Workers
let videoStreamWorker: Worker | null;
let audioStreamWorker: Worker | null;
let videoEncoderWorker: Worker | null;
let audioEncoderWorker: Worker | null;
let muxerSenderWorker: Worker | null;

const createWorkers = () => {
    //create new web workers for A/V frames capture
    videoStreamWorker = new Worker("./video_capture.ts");
    audioStreamWorker = new Worker("./audio_capture.ts");

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

      //create a MediaStreamTrackProcessor, which
      //exposes frames from the track as a ReadableStream of VideoFrames
      const videoTrack = mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        const trackProcessor = new MediaStreamTrackProcessor({
          track: videoTrack,
        });

        //read frames flowing through the MediaStreamTrack provided to the processor
        const videoFrameStream = trackProcessor.readable;


      } else {
        console.error("No video track found");
      }
    })
  };
