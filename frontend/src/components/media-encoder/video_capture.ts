async function videoCaptureLoop(
  frameReader: ReadableStreamDefaultReader<VideoFrame>,
): Promise<boolean> {
  try {
    frameReader.read().then((result: ReadableStreamReadResult<VideoFrame>) => {
      if (result.done) {
        frameReader.cancel("ended").then(() => false);
      } else {
        const videoFrame = result.value;

        //Send frame to process
        self.postMessage({
          type: "videoframe",
          clkms: Date.now(), //clock in milliseconds
          data: videoFrame,
        });
      }
      return false;
    });
  } catch (error) {
    console.error(error);
  }
  return false;
}

self.addEventListener("message", async (event: MessageEvent) => {
  const { type, data } = event.data;

  switch (type) {
    case "stop":
      break;
    case "stream":
      const videoFrameStream = data?.videoStream as ReadableStream<VideoFrame>;
      if (videoFrameStream) {
        const videoFrameReader = videoFrameStream.getReader();

        setInterval(() => videoCaptureLoop(videoFrameReader), 1);
      }
      break;
    default:
      break;
  }
});
