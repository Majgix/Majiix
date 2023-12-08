import { createSignal } from "solid-js";
import "./Render.css";

export default function Render() {
  const [mediaElement, setMediaElement] = createSignal<HTMLVideoElement | null>(
    null,
  );

  

  return (
    <div>
      <p>todo!</p>
    </div>
  );
}
