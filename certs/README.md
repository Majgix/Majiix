## Local Development

The certs folder contains some helpful scripts for local development.

## Setup

QUIC mandates TLS even for local development, which is unfortunate. We have added some scripts to help us along.

First, cd into this folder!

```sh
cd certs
```

Second, install `mkcert` and set up your own development Certificate Authority (CA).

```sh
./install.sh
```

Then generate certificates in .pem (Base64 encoded, needed for the frontend) form and additionally convert to .der (binary, needed for the backend) form.

```sh
./mkcert.sh
```

Finally, launch the Chrome browser with flags to allow to use the self-signed certificate. We don't yet fully understand why this is necessary, as the certificate has a "valid" CA. Possibly there are other requirements?

```sh
./launch_chrome.sh
```
