#!/bin/sh
# Makes media/sam-apples.mp3 from the transcript with Piper (https://github.com/rhasspy/piper),
# voice en-us-amy-low, then a 48 kbit/s mono MP3. Run from the bundle directory.
set -e
piper -m en-us-amy-low.onnx -f /tmp/sam-apples.wav < media/sam-apples.txt
ffmpeg -loglevel error -y -i /tmp/sam-apples.wav -ac 1 -b:a 48k -map_metadata -1 media/sam-apples.mp3
