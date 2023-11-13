import Hls from "hls.js";
import { createSignal } from "solid-js";
import "./Render.css";

export default function Render() {
  const [mediaElement, setMediaElement] = createSignal<HTMLVideoElement | null>(
    null,
  );

  const [mediaElement2, setMediaElement2] =
    createSignal<HTMLVideoElement | null>(null);

  const testHLSPlayback = async () => {
    const src = "http://localhost:8080/media/bbb-720p/v.m3u8";
    try {
      const video = document.createElement("video");

      if (Hls.isSupported()) {
        // TODO: specify "workerPath", so web workers are used
        const hls = new Hls();

        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          console.log("video and hls.js are now bound together!");
        });
        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          console.log(
            "manifest loaded, found " + data.levels.length + " quality level",
          );
        });

        hls.loadSource(src);
        hls.attachMedia(video);

        setMediaElement2(video);

        video.play();
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // HLS.js is not supported on platforms that have native HLS support (like Safari on desktop and mobile)
        video.src = src;
        video.addEventListener("loadedmetadata", () => {
          video.play();
        });
      }
    } catch (error) {
      console.error("Error starting playback stream: ", error);
    }
  };

  const startStream = async () => {
    const localMedia = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    try {
      const video = document.createElement("video");
      video.srcObject = localMedia;
      video.play();

      setMediaElement(video);

      const url = "https://127.0.0.1:8080/start-stream";

      const webTransport = new WebTransport(url);
      await webTransport.ready;
    } catch (error) {
      console.error("Error starting stream: ", error);
    }
  };

  return (
    <div>
      <button onClick={startStream} class="increment">
        Start stream
      </button>
      <button onClick={testHLSPlayback} class="increment">
        Test HLS playback
      </button>
      {mediaElement()}
      {mediaElement2()}
    </div>
  );
}
