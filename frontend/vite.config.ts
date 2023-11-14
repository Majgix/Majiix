import { readFile, readFileSync } from "fs";
import solid from "solid-start/vite";
import { defineConfig } from "vite";
import mkcert from 'vite-plugin-mkcert';

//const secureLocalhost = true;
let keyPath = '../certs/localhost-key.pem';
let certPath = '../certs/localhost.pem';

let key = readFileSync(keyPath);
let cert = readFileSync(certPath);

export default defineConfig({
  server: {
      https: {
        key,
        cert,
      }
   },
  plugins: [
    //secureLocalhost && mkcert(),
    solid()
  ],
});
