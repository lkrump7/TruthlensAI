# Image captions and video transcripts — design

## Intent

Images and videos enter TruthLens the same way excerpts and websites do.
An image becomes a document whose text is a caption. A video becomes a
document whose text is a timestamped transcript plus frame descriptions.
Claims are then pulled out and checked by the existing pipeline. Nothing
new is judged here: this only turns pictures and video into honest text.

Decisions settled with the requester (2026-10-31):

- Feed the verification pipeline, not extraction-only output.
- Images: Muse Spark 1.3 vision, same transport as OCR.
- Video: ffmpeg splits audio into chunks for Muse Voice Transcribe
  (`muse-voice-transcribe-1.0`) and samples frames for Spark captions,
  merged by timestamp. No native Meta video endpoint is used, because
  none is configured in this app.

## Flow

```text
image file ──> Spark vision caption ──> pages:[{page:1, text:caption}]
                                            │
video file ──> ffmpeg ─┬─ audio chunks ─> Voice Transcribe ─┐
                       └─ frames ───────> Spark captions ───┴─> pages per time window
                                            │
                                            v
                              createDocument(kind: image|video)
                              chunk → screen → extract claims → verify (unchanged)
```

## Rules that match the existing pipelines

- No Meta key, no output. Routes return 503, like `/api/transcribe`.
  No demo caption or transcript is invented.
- A model failure is a 502, not a silent empty document.
- Empty result (blank image caption, silent video with no frames) is 422.
- Captions must carry checkable content: describe the scene, transcribe
  visible text exactly, and state visible facts as plain sentences so
  `extractClaimsFromPages` can find them.
- Video pages are time windows. Each page reads
  `[mm:ss–mm:ss] Speech: … Visual: …`, so a claim keeps its timestamp
  as its "page".
- Limits: image 10 MB (png/jpeg/webp/gif), video 100 MB and 10 minutes.
  Audio chunks stay under the voice limits (50 s per chunk); frames are
  capped at 12, one per 10 s, scaled down before captioning.

## Non-goals

- No video generation, editing, or streaming. Upload only.
- No speaker identification beyond what Voice Transcribe returns.
- No new providers. ffmpeg is a local binary, already installed.
