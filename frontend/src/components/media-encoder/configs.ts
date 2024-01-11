//!Config values for the encoders
//!We just hardcode these for now

// Video encoder config
export const videoEncoderConfig = {
    encoderConfig: {
      codec: 'avc1.42001e', //see https://en.wikipedia.org/wiki/Advanced_Video_Coding
      width: 320,
      height: 180,
      bitrate: 2000_000, //2 Mbps
      framerate: 30,
      latencyMode: 'realtime' //Send  1 chunk per frame
    },
    encoderMaxQueSize: 2,
    keyframeEvery: 60,
};
  
// Audio encoder config
export const audioEncoderConfig = {
  encoderConfig: {
    codec: 'opus',
    sampleRate: 48000, //Hz
    memberOfChannels: 1,
    bitrate: 32000,
  },
  encoderMaxQueSize: 10,
};

export const muxerSenderConfig = {
  audioMaxQueSize: 200,
  videoMaxQueSize: 100,
  
  maxInflightAudioRequests: 100,
  maxInflightVideoRequests: 50,

  urlHostPort: '127.0.0.1',
  UrlPath: '4443',

  maxAgeChunks: 120,
}

export {};
