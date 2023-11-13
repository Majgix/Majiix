#!/bin/bash
set -e # Exit on error

FFMPEG_DIR=ffmpeg

pushd "$FFMPEG_DIR" # Move into the FFmpeg directory

make install

popd # Return to the original directory

echo "FFmpeg install complete."
