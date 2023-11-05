import { createSignal } from "solid-js";
import "./Render.css";


export default function Render() {
  const [mediaElement, setMediaElement] = createSignal<HTMLVideoElement | null>(null);
  
  const startStream = async () => {

    const localMedia = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    })
    
    try {

      const video = document.createElement("video");
      
      //attach the local media stream to a video element
      video.srcObject = localMedia;
      video.play();

      setMediaElement(video)

      const url = "https://127.0.0.1:8080/start-stream";

      const webTransport = new WebTransport(url);

      //open the webTransport connection
      await webTransport.ready
      
      
    } catch (error) {
      
      console.error("Error starting stream: ", error);
    }
  }

  return (
    <div>
      <button onClick={startStream} class="increment">
        Start stream
      </button>
      {mediaElement()}
    </div>
  );
}
