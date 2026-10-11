# Sparkfire

A local-first workspace where files go through AI modules and every result stays a typed, linked artifact.

## Language

**Text-to-video**:
The module that turns a prompt, and optionally a first frame, into a generated video.
_Avoid_: video generation module, t2v

**Generated video**:
A video with its own sound track, made by text-to-video and kept as an artifact of its job.
_Avoid_: clip, movie

**First frame**:
An image artifact that a generated video starts from.
_Avoid_: seed image, start image, i2v input
