import { Title } from "solid-start";
import Render from "~/components/Render";

export default function Home() {
  return (
    <main>
      <Title>{import.meta.env.VITE_APP_TITLE}</Title>
      <h1>Welcome to {import.meta.env.VITE_APP_TITLE}!</h1>
      <h2 class="h2"> Uniting the World, One video at a time</h2>
      <Render />
    </main>
  );
}
