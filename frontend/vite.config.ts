import { readFile, readFileSync } from "fs";
import solid from "solid-start/vite";
import { defineConfig } from "vite";

let keyPath = "../certs/localhost-key.pem";
let certPath = "../certs/localhost.pem";

let key = readFileSync(keyPath);
let cert = readFileSync(certPath);

export default defineConfig({
  server: {
    https: {
      key,
      cert,
    },
  },
  plugins: [solid()],
});
