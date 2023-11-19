## Local Development

The certs folder contains some helpful scripts for local development. 

## Setup

QUIC mandates TLS even for local development, which makes local dev difficult. We have added some scripts to help us along. 

First we need to generate a TLS certificate and it's corresponding private key:

```bash
cd certs
chmod +x certs/generate_certs.sh 
./generate_certs.sh  
```
And then launch the chrome browser with some flags indicating what host and port should be allowed to use the self-signed certificate.

```bash
chmod +x certs/launch_chrome.sh
./launch_chrome.sh
```
