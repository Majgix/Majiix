import { readFileSync } from "fs";
import solid from "solid-start/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server:
    process.env["NODE_ENV"] === "development"
      ? {
          https: {
            key: readFileSync("../certs/localhost-pem.key"),
            cert: readFileSync("../certs/localhost.pem"),
          },
        }
      : undefined,
  plugins: [solid()],
});
