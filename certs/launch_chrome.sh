#!/bin/bash

set -e

case `uname` in
    (*Linux*)  
        SPKI=`openssl x509 -inform der -in localhost.crt.der -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64`

        echo "Got cert key $SPKI"

        google-chrome --origin-to-force-quic-on=127.0.0.1:4443 --ignore-certificate-errors-spki-list=$SPKI --enable-logging --v=1
        ;;
    (*Darwin*)
        open -a "Google Chrome" --args --webtransport-developer-mode --enable-logging --v=1
        ;;
esac

## Logs are stored to ~/Library/Application Support/Google/Chrome/chrome_debug.log
