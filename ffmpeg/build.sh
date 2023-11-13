#!/bin/bash
set -e # Exit on error

FFMPEG_DIR=ffmpeg

# Clone FFmpeg if the directory doesn't exist
if [ ! -d "$FFMPEG_DIR" ]; then
    git clone https://git.ffmpeg.org/ffmpeg.git "$FFMPEG_DIR"
    pushd "$FFMPEG_DIR" # Move into the FFmpeg directory
else
    echo "FFmpeg directory already exists, pulling latest changes..."
    pushd "$FFMPEG_DIR" # Move into the FFmpeg directory
    git pull origin master
fi

# Configure FFmpeg
# You can add your own custom flags here
./configure

# Build FFmpeg
make

popd # Return to the original directory

echo "FFmpeg build complete."
