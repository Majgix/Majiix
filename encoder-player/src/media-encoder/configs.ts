// Video encoder config
export const videoEncoderConfig = {
  encoderConfig: {    
    codec: "av01.0.04M.08", // AV1 Main Profile, Main tier, 10 bits per color
    width: 320,
    height: 180,
    bitrate: 2000_000, //2 Mbps
    framerate: 30, //fps
    latencyMode: "realtime", //Send  1 chunk per frame
  },
  encoderMaxQueSize: 2,
  keyframeEvery: 60,
};

// Audio encoder config
export const audioEncoderConfig = {
  encoderConfig: {
    codec: "opus",
    sampleRate: 48000, //Hz
    numberOfChannels: 1,
    bitrate: 128000,
  },
  encoderMaxQueSize: 10,
};

export const muxerSenderConfig = {
  urlHostPort: "127.0.0.1",
  urlPath: "4443",

  moqTracks: {
             "audio": {
                 id: 0,
                 namespace: "vc",
                 name: "aaa/audio",
                 maxInFlightRequests: 100,
                 isHipri: true,
                 authInfo: "secret"
             },
             "video": {
                 id: 1,
                 namespace: "vc",
                 name: "aaa/video",
                 maxInFlightRequests: 50,
                 isHipri: false,
                 authInfo: "secret"
             }
   }
};

export {};
