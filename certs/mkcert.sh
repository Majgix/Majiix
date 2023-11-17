#!/bin/bash
set -e # Exit on error

mkcert \
  -cert-file localhost.pem\
  -key-file localhost-key.pem\
  localhost 127.0.0.1 ::1
