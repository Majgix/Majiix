async function videoCaptureLoop(
  frameReader: ReadableStreamDefaultReader<VideoFrame>,
): Promise<boolean> {
  console.log("Starting video Capture Worker");
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
  console.log("video capture worker listening for events!");
  const { type, data } = event.data;

  switch (type) {
    case "stop":
      break;
    case "videostream":
      const videoFrameStream = data?.videoStream as ReadableStream<VideoFrame>;
      if (videoFrameStream) {
        const videoFrameReader = videoFrameStream.getReader();

        await videoCaptureLoop(videoFrameReader);
      }
      break;
  }
});
