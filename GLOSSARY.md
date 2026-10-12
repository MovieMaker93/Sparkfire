# Sparkfire

A fork of SparklingKit that runs many AI services at once on one DGX Spark, behind one workspace where
files go through modules and every result stays a typed, linked artifact.

## Workspace

**Workbench**:
The start page, where any module can be started and running and recent work is shown.
_Avoid_: dashboard, home

**Job**:
One folder of work: its sources, its artifacts and the runs that made them.
_Avoid_: task, project

**Artifact**:
A typed file in a job, with a stable identity and lineage.
_Avoid_: output file, result file

**Lineage**:
The record of which artifacts and which run an artifact came from.
_Avoid_: provenance

**Run**:
One pass of a module over a job's artifacts.
_Avoid_: execution, workflow run

**Continue with**:
Handing an artifact to another module, as a new run in the same job.
_Avoid_: handoff, chain

**Preset**:
A saved instruction that the language model runs on a job's text.
_Avoid_: prompt template

## Modules and services

**Module**:
A capability the workspace offers: OCR, transcription, translation, grounding, text to image, text to
video, mind map or chat.
_Avoid_: tool, feature

**Service**:
A model behind an OpenAI-compatible API that a module calls; its URL is its endpoint.
_Avoid_: provider, backend

**Reference stack**:
The services that the start script runs together on one Spark, one for each use case.
_Avoid_: DGX stack, bundle

**Spark**:
The NVIDIA DGX Spark that runs the reference stack.
_Avoid_: the box

**Conversation**:
One saved exchange with the language model, with its attachments.
_Avoid_: thread, session

## Heavy work

**Heavy job**:
A run whose service loads tens of GiB only while it works, such as text to video.
_Avoid_: big job

**GPU lane**:
The line in which heavy jobs take turns, one at a time and in order.
_Avoid_: heavy-job lane, heavy queue

## Workflows

**Workflow**:
A saved graph of nodes that runs modules on a new input.
_Avoid_: flow, pipeline

**Workflow run**:
One execution of a workflow on a job, with a snapshot of the workflow it ran.
_Avoid_: flow run

## Video

**Text to video**:
The module that turns a prompt, and optionally a first frame, into a generated video.
_Avoid_: video generation module, t2v

**Generated video**:
A video with its own sound track, made by text to video and kept as an artifact of its job.
_Avoid_: clip, movie

**First frame**:
An image artifact that a generated video starts from.
_Avoid_: seed image, start image, i2v input
