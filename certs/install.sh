#!/bin/bash
set -e # Exit on error

case "$(uname -s)" in
  Darwin)
    brew install mkcert
    brew install nss # if you ever use Firefox
    mkcert -install
    ;;

  Linux)
    echo 'instructions will open in your browser...'
    sleep 2
    echo 'but make sure you run `mkcert -install` too!'
    sleep 3
    open 'https://github.com/FiloSottile/mkcert#installation'
    ;;
esac

