async function audioCaptureLoop(frameReader: ReadableStreamDefaultReader<AudioData>): Promise<boolean> {
  console.log("Starting audio capture worker."); 
  try {
        const {done, value} = await frameReader.read();

        if (done) {
            await frameReader.cancel("ended");
        } else {
            const audioFrame: AudioData = value;

            //Clone the audio data before transferring
            const cloneFrame = audioFrame.clone();
            self.postMessage({
                type: "audioframe",
                clkms: Date.now(), // clock in milliseconds
                data: cloneFrame,
            });
            audioFrame.close();
            
            return true;
        }
    } catch (error) {
        console.error(error);
    } 
    return false;
};

self.addEventListener('message',async (event: MessageEvent) => {
    const {type, data} =  event.data;

    switch (type) {
        case "stop":
            break;
        case "astream":
            const audioFrameStream = data.audioStream as ReadableStream<AudioData>;
            const audioFrameReader = audioFrameStream.getReader();

            audioCaptureLoop(audioFrameReader);
            break;
    }
})
