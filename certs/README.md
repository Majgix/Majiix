## Local Development

The certs folder contains some helpful scripts for local development.

## Setup

QUIC mandates TLS even for local development, which is unfortunate. We have added some scripts to help us along.

First we need to generate a TLS certificate and its corresponding private key:

```sh
cd certs
./generate_certs.sh
```

And then launch the chrome browser with some flags indicating what host and port should be allowed to use the self-signed certificate.

```sh
./launch_chrome.sh
```
