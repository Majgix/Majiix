export enum State {
  Created = "created",
  Instatiated = "instatiated",
  Running = "running",
  Stopped = "stopped",
}

export function arrayBufferToBase64(buffer: any) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }

  return btoa(binary);
}

export {};
