// Video encoder config
const videoEncoderConfig = {
    encoderConfig: {
      codec: 'avc1.42001e', //see https://en.wikipedia.org/wiki/Advanced_Video_Coding
      width: 320,
      height: 180,
      bitrate: 1000_000, //1 Mbps
      framerate: 30,
      latencyMode: 'realtime' //Send  1 chunk per frame
    },
    encoderMaxQueSize: 2,
    keyframeEvery: 60,
  };
  
  const audioEncoderConfig = {
    encoderConfig: {
      codec: 'opus',
      sampleRate: 48000,
      memberOfChannels: 1,
      bitrate: 32000,
    },
    encoderMaxQueSize: 10,
  }
