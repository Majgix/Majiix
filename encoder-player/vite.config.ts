import { readFileSync } from "fs";
import solid from "solid-start/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server:
    process.env["NODE_ENV"] === "development"
      ? {
          https: {
            key: readFileSync("../scripts/localhost.key.pem"),
            cert: readFileSync("../scripts/localhost.crt.pem"),
          },
        }
      : undefined,
  plugins: [solid()],
});
