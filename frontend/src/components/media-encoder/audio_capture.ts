//console.log("audio capture worker loaded");
async function audioCaptureLoop(
  frameReader: ReadableStreamDefaultReader<AudioData>,
): Promise<boolean> {
  console.log("starting audio capture loop");
  try {
    const result = await frameReader.read();

    if (result.done) {
      await frameReader.cancel("ended");
      return false;
    }

    const audioFrame = result.value;

    try {
      self.postMessage({
        type: "audioframe",
        clkms: Date.now(),
        data: audioFrame.clone(),
      });
    } finally {
      audioFrame.close();
    }

    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

self.addEventListener("message", async (event: MessageEvent) => {
  console.log("audio capture worker listening for events");

  const { type, data } = event.data;

  switch (type) {
    case "stop":
      break;
    case "audiostream":
      const audioFrameStream = data?.audioStream as ReadableStream<AudioData>;

      if(audioFrameStream) {
        const audioFrameReader = audioFrameStream.getReader();
        await audioCaptureLoop(audioFrameReader);
      }

      break;
  }
});
