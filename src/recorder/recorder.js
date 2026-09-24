"use strict";
/**
 * The replay buffer's recorder. Runs in a hidden window (see
 * src/main/streamer.js). Records the Minecraft window (+ optional system
 * audio) as back-to-back WebM segments: every `segmentMs` a new
 * MediaRecorder starts and the previous one stops a moment later, so each
 * segment is a complete file on its own and the seams overlap slightly
 * (webm.js trims the overlap when a clip is joined).
 */
let stream = null;
let current = null;
let segCounter = 0;
let rotateTimer = null;
let cfg = null;
let mimeType = "";

function pickMime(withAudio) {
  const options = withAudio
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
}

function beginSegment() {
  const seg = ++segCounter;
  const rec = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: cfg.videoBitsPerSecond,
    audioBitsPerSecond: 160000,
  });
  // Chunks are forwarded strictly in order, and "segment ended" is only
  // reported after the last one has been handed over.
  let chain = Promise.resolve();
  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    chain = chain.then(async () => window.recorder.chunk(seg, await e.data.arrayBuffer()));
  };
  rec.onstop = () => {
    const endMs = Date.now();
    chain.then(() => window.recorder.segmentEnd(seg, endMs));
  };
  rec.onerror = (e) => window.recorder.state(true, (e.error && e.error.message) || "Recorder error");
  const startMs = Date.now();
  rec.start(1000);
  window.recorder.segmentBegin(seg, startMs);
  return rec;
}

function rotate() {
  if (!stream) return;
  const old = current;
  current = beginSegment();
  // A short overlap so no frame falls into a gap between the two files.
  setTimeout(() => {
    if (old && old.state !== "inactive") old.stop();
  }, 400);
}

async function start(config) {
  await stop();
  cfg = config;
  try {
    const video = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: cfg.sourceId,
          maxFrameRate: cfg.fps,
          maxWidth: cfg.maxWidth,
          maxHeight: cfg.maxHeight,
        },
      },
    });
    const tracks = [...video.getVideoTracks()];
    let audioProblem = null;
    if (cfg.audio) {
      try {
        // System audio on Windows only comes with a desktop video source;
        // take its audio and drop the extra video track straight away.
        const withAudio = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: "desktop" } },
          video: { mandatory: { chromeMediaSource: "desktop", maxWidth: 16, maxHeight: 16, maxFrameRate: 1 } },
        });
        withAudio.getVideoTracks().forEach((t) => t.stop());
        tracks.push(...withAudio.getAudioTracks());
      } catch (err) {
        audioProblem = "Recording without sound: " + (err && err.message ? err.message : "system audio unavailable");
      }
    }
    stream = new MediaStream(tracks);
    mimeType = pickMime(stream.getAudioTracks().length > 0);
    // The game window closing ends the capture on its own.
    tracks[0].addEventListener("ended", () => stop());
    current = beginSegment();
    rotateTimer = setInterval(rotate, cfg.segmentMs);
    window.recorder.state(true, audioProblem);
  } catch (err) {
    window.recorder.state(false, "Couldn't capture the Minecraft window: " + (err && err.message ? err.message : err));
  }
}

async function stop() {
  clearInterval(rotateTimer);
  rotateTimer = null;
  if (current && current.state !== "inactive") current.stop();
  current = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  window.recorder.state(false, null);
}

window.recorder.onStart((c) => start(c));
window.recorder.onStop(() => stop());
window.recorder.onRotate(() => {
  if (!stream) return;
  clearInterval(rotateTimer);
  rotate();
  rotateTimer = setInterval(rotate, cfg.segmentMs);
});
