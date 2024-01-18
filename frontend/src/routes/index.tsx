import { Title } from "solid-start";
import Render from "~/components/Render";

export default function Home() {
  return (
    <main>
      <Title>{import.meta.env.VITE_APP_TITLE}</Title>
      <h1>Refine your network.</h1>
      <h2>Majiix is the simple, open and low-latency platform for realtime collaboration on the web.</h2>
      <Render />
    </main>
  );
}
