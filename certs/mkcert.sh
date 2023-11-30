#!/bin/bash
set -e # Exit on error

rm localhost*

mkcert \
  -cert-file localhost.crt.pem\
  -key-file localhost.key.pem\
  localhost 127.0.0.1 ::1

# NOTE: view the certificate using `openssl x509 -in localhost.crt.pem -text -noout`

openssl x509 -in localhost.crt.pem -outform der -out localhost.crt.der
openssl rsa -in localhost.key.pem -outform DER -out localhost.key.der
