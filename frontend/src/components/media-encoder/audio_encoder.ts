import "./utils";
import { State } from "./utils";
console.log("audio encoder worker loaded");
let workerState = State.Created;

let audioEncoder: AudioEncoder | null = null;

//Encoder
const initAudioEncoder = {
  output: handleAudioChunk,
  error: (e: Error) => {
    console.error(e.message);
  },
};

function handleAudioChunk(chunk: EncodedAudioChunk) {
  const message = {
    type: "audiochunk",
    chunk: chunk,
  };

  self.postMessage(message);
}

self.addEventListener("message", async (event: MessageEvent) => {
  console.log("audio encoder worker listening for events!");
  const message = event.data;
  const type = event.data.type;

  if (workerState == State.Created) {
    workerState = State.Instatiated;
  }

  switch (type) {
    case "stop":
      workerState = State.Stopped;
      await audioEncoder?.flush();

      audioEncoder?.close();
      return;
    case "aencoderini":
      const encoderConfig: AudioEncoderConfig = message.encoderConfig;

      audioEncoder = new AudioEncoder(initAudioEncoder);
      audioEncoder.configure(encoderConfig);

      return;
    case "audioframe":
      const audioFrame: AudioData = event.data.audioframe;
      audioEncoder?.encode(audioFrame);
      audioFrame.close();

      return;
  }
});
