"use strict";
/**
 * Joins the replay buffer's WebM segments into one clip - pure JavaScript,
 * no ffmpeg to ship.
 *
 * The recorder (src/recorder) writes the last N minutes as a rolling set of
 * short, self-contained WebM files that overlap slightly at the seams. A
 * clip is: the header + tracks of the first segment, then the clusters of
 * every segment in order with overlapping bits dropped, every cluster's
 * timestamp rewritten onto one continuous timeline, plus a proper Duration,
 * SeekHead and Cues so the result seeks normally in any player (Discord,
 * browsers, VLC, editors).
 *
 * EBML/Matroska references: https://www.matroska.org/technical/elements.html
 */
const fs = require("fs");
const fsp = fs.promises;

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Void: 0xec,
};
const SEGMENT_LEVEL = new Set([ID.Cluster, ID.Cues, ID.Info, ID.Tracks, ID.SeekHead, 0x1254c367, 0x1043a770, 0x1941a469]);

/* ---------------- reading ---------------- */

function readId(buf, pos) {
  const first = buf[pos];
  if (first === undefined) return null;
  let len = 1;
  for (let mask = 0x80; len <= 4 && !(first & mask); mask >>= 1) len++;
  if (len > 4 || pos + len > buf.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { id, len };
}

function readSize(buf, pos) {
  const first = buf[pos];
  if (first === undefined) return null;
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 8 || pos + len > buf.length) return null;
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { size: allOnes ? -1 : value, len }; // -1 = unknown size (live-recorded)
}

function readHeader(buf, pos) {
  const id = readId(buf, pos);
  if (!id) return null;
  const size = readSize(buf, pos + id.len);
  if (!size) return null;
  return { id: id.id, headerLen: id.len + size.len, size: size.size, start: pos, dataStart: pos + id.len + size.len };
}

function readUint(buf, start, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[start + i];
  return v;
}

/**
 * Parses one segment file. Returns { ebmlHeader: Buffer, tracks: Buffer,
 * timecodeScale, videoTrack, clusters: [{ timecode, children: Buffer,
 * startsWithKeyframe }] }.
 */
function parseSegment(buf) {
  let pos = 0;
  let ebmlHeader = null;
  const out = { ebmlHeader: null, tracks: null, timecodeScale: 1000000, videoTrack: null, clusters: [] };
  while (pos < buf.length) {
    const h = readHeader(buf, pos);
    if (!h) break;
    if (h.id === ID.EBML) {
      ebmlHeader = buf.subarray(h.start, h.dataStart + h.size);
      pos = h.dataStart + h.size;
      continue;
    }
    if (h.id !== ID.Segment) {
      if (h.size < 0) break;
      pos = h.dataStart + h.size;
      continue;
    }
    const segEnd = h.size < 0 ? buf.length : Math.min(buf.length, h.dataStart + h.size);
    let p = h.dataStart;
    while (p < segEnd) {
      const c = readHeader(buf, p);
      if (!c) break;
      if (c.id === ID.Cluster) {
        const cluster = parseCluster(buf, c, segEnd);
        if (cluster) out.clusters.push(cluster);
        p = cluster ? cluster.end : segEnd;
        continue;
      }
      if (c.size < 0) break; // an unknown-size non-cluster: nothing sensible after it
      const end = Math.min(segEnd, c.dataStart + c.size);
      if (c.id === ID.Info) out.timecodeScale = parseInfoScale(buf, c.dataStart, end) || out.timecodeScale;
      if (c.id === ID.Tracks) {
        out.tracks = buf.subarray(c.start, end);
        out.videoTrack = findVideoTrack(buf, c.dataStart, end);
      }
      p = end;
    }
    break;
  }
  out.ebmlHeader = ebmlHeader;
  // Tag each cluster with whether its first block for the video track is a keyframe.
  for (const cl of out.clusters) cl.startsWithKeyframe = firstVideoBlockIsKey(cl.children, out.videoTrack);
  return out;
}

function parseInfoScale(buf, start, end) {
  let p = start;
  while (p < end) {
    const h = readHeader(buf, p);
    if (!h || h.size < 0) break;
    if (h.id === ID.TimecodeScale) return readUint(buf, h.dataStart, h.size);
    p = h.dataStart + h.size;
  }
  return null;
}

function findVideoTrack(buf, start, end) {
  let p = start;
  while (p < end) {
    const h = readHeader(buf, p);
    if (!h || h.size < 0) break;
    if (h.id === ID.TrackEntry) {
      let q = h.dataStart;
      let num = null;
      let type = null;
      const e = h.dataStart + h.size;
      while (q < e) {
        const f = readHeader(buf, q);
        if (!f || f.size < 0) break;
        if (f.id === ID.TrackNumber) num = readUint(buf, f.dataStart, f.size);
        if (f.id === ID.TrackType) type = readUint(buf, f.dataStart, f.size);
        q = f.dataStart + f.size;
      }
      if (type === 1) return num;
    }
    p = h.dataStart + h.size;
  }
  return null;
}

function parseCluster(buf, h, segEnd) {
  const end = h.size < 0 ? segEnd : Math.min(segEnd, h.dataStart + h.size);
  let p = h.dataStart;
  let timecode = 0;
  const kept = [];
  while (p < end) {
    const c = readHeader(buf, p);
    if (!c) break;
    if (h.size < 0 && SEGMENT_LEVEL.has(c.id)) break; // next top-level element: this live cluster ended
    if (c.size < 0) break;
    const cEnd = c.dataStart + c.size;
    if (cEnd > buf.length) break; // truncated tail of a segment still being written
    if (c.id === ID.Timecode) timecode = readUint(buf, c.dataStart, c.size);
    else if (c.id === ID.SimpleBlock || c.id === ID.BlockGroup) kept.push(buf.subarray(c.start, cEnd));
    p = cEnd;
  }
  return { timecode, children: kept, end: p };
}

/**
 * Is the first video frame in this cluster a keyframe? Chromium writes
 * audio as SimpleBlocks (keyframe = flag bit 0x80) but video as
 * BlockGroups, where a keyframe is a group with no ReferenceBlock in it.
 */
function firstVideoBlockIsKey(children, videoTrack) {
  for (const el of children) {
    const h = readHeader(el, 0);
    if (!h) continue;
    if (h.id === ID.SimpleBlock) {
      const track = readSize(el, h.dataStart); // track number is a vint
      if (!track || (videoTrack !== null && track.size !== videoTrack)) continue;
      return Boolean(el[h.dataStart + track.len + 2] & 0x80);
    }
    if (h.id === ID.BlockGroup) {
      let p = h.dataStart;
      const end = Math.min(el.length, h.size < 0 ? el.length : h.dataStart + h.size);
      let track = null;
      let referenced = false;
      while (p < end) {
        const c = readHeader(el, p);
        if (!c || c.size < 0) break;
        if (c.id === ID.Block) {
          const t = readSize(el, c.dataStart);
          track = t ? t.size : null;
        }
        if (c.id === ID.ReferenceBlock) referenced = true;
        p = c.dataStart + c.size;
      }
      if (track === null || (videoTrack !== null && track !== videoTrack)) continue;
      return !referenced;
    }
  }
  return false;
}

/** Relative timecode (int16, in timecode-scale units) of a SimpleBlock or BlockGroup, or null. */
function blockRelTime(el) {
  const h = readHeader(el, 0);
  if (!h) return null;
  let blockStart = null;
  if (h.id === ID.SimpleBlock) blockStart = h.dataStart;
  else if (h.id === ID.BlockGroup) {
    let p = h.dataStart;
    while (p < el.length) {
      const c = readHeader(el, p);
      if (!c || c.size < 0) break;
      if (c.id === ID.Block) {
        blockStart = c.dataStart;
        break;
      }
      p = c.dataStart + c.size;
    }
  }
  if (blockStart === null) return null;
  const track = readSize(el, blockStart);
  if (!track || blockStart + track.len + 2 > el.length) return null;
  return el.readInt16BE(blockStart + track.len);
}

/* ---------------- writing ---------------- */

function idBytes(id) {
  const bytes = [];
  let v = id;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return Buffer.from(bytes);
}

function sizeBytes(size, len) {
  // Smallest length that fits, unless a fixed length is asked for (placeholders).
  let n = len || 1;
  if (!len) while (size >= 2 ** (7 * n) - 1) n++;
  const out = Buffer.alloc(n);
  let v = size;
  for (let i = n - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (n - 1);
  return out;
}

function uintBytes(v) {
  if (v === 0) return Buffer.from([0]);
  const bytes = [];
  let x = v;
  while (x > 0) {
    bytes.unshift(x % 256);
    x = Math.floor(x / 256);
  }
  return Buffer.from(bytes);
}

function el(id, payload) {
  return Buffer.concat([idBytes(id), sizeBytes(payload.length), payload]);
}
const uintEl = (id, v) => el(id, uintBytes(v));
function floatEl(id, v) {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(v);
  return el(id, b);
}
const strEl = (id, s) => el(id, Buffer.from(s, "utf8"));

/**
 * segments: [{ file, startMs, endMs }] oldest first (wall-clock times).
 * Writes the part from `fromMs` onward into `outFile`. Returns { durationMs }.
 */
async function joinSegments(segments, fromMs, outFile) {
  let usable = segments.filter((s) => s.endMs > fromMs);
  if (!usable.length) throw new Error("Nothing has been recorded yet.");

  // A clip has to open on a keyframe. Rather than skipping forward to the
  // next one (and handing back a clip shorter than asked for), step back to
  // the last keyframe at or before the requested start - a clip can come out
  // a second or two longer, never shorter.
  {
    const first = usable[0];
    const next = usable[1];
    if (first.startMs >= fromMs) {
      fromMs = first.startMs;
    } else {
      const parsed = parseSegment(await fsp.readFile(first.file));
      const scaleMs = parsed.timecodeScale / 1e6;
      let best = first.startMs; // every segment opens on a keyframe
      for (const cl of parsed.clusters) {
        const abs = first.startMs + cl.timecode * scaleMs;
        if (abs > fromMs || (next && abs >= next.startMs)) break;
        if (cl.startsWithKeyframe) best = abs;
      }
      fromMs = best;
    }
    usable = segments.filter((s) => s.endMs > fromMs);
  }

  const fh = await fsp.open(outFile, "w");
  let written = 0;
  const write = async (b) => {
    await fh.write(b, 0, b.length, written);
    written += b.length;
  };

  try {
    let header = null;
    let clipStart = null; // wall-clock ms of the clip's time zero
    let lastEnd = 0;
    const cues = [];
    let segDataStart = 0;
    let seekHeadCuesPos = 0; // file offset of the SeekPosition payload to patch
    let segSizePos = 0;

    for (let i = 0; i < usable.length; i++) {
      const seg = usable[i];
      const next = usable[i + 1];
      const parsed = parseSegment(await fsp.readFile(seg.file));
      if (!parsed.clusters.length) continue;
      const scaleMs = parsed.timecodeScale / 1e6;

      if (!header) {
        if (!parsed.ebmlHeader || !parsed.tracks) continue;
        header = parsed;
        await write(parsed.ebmlHeader);
        // Segment with an 8-byte size placeholder, patched at the end.
        await write(idBytes(ID.Segment));
        segSizePos = written;
        await write(sizeBytes(0, 8));
        segDataStart = written;
        // SeekHead pointing at Cues (8-byte position placeholder, patched later).
        const seekPosPayload = Buffer.alloc(8);
        const seek = el(ID.Seek, Buffer.concat([el(ID.SeekID, idBytes(ID.Cues)), el(ID.SeekPosition, seekPosPayload)]));
        const seekHead = el(ID.SeekHead, seek);
        seekHeadCuesPos = written + seekHead.length - 8;
        await write(seekHead);
        // Info with a Duration placeholder we can patch (float64, fixed size).
        const info = el(
          ID.Info,
          Buffer.concat([uintEl(ID.TimecodeScale, 1000000), strEl(ID.MuxingApp, "Reminth"), strEl(ID.WritingApp, "Reminth"), floatEl(ID.Duration, 0)])
        );
        header.durationPos = written + info.length - 8;
        await write(info);
        await write(parsed.tracks);
      }

      let started = clipStart !== null;
      for (const cl of parsed.clusters) {
        const absMs = seg.startMs + cl.timecode * scaleMs;
        if (next && absMs >= next.startMs) break; // the next segment covers this part
        if (absMs + 1 < lastEnd) continue; // overlap with what's already written
        if (!started) {
          // A clip has to begin on a keyframe or it opens as grey mush.
          if (absMs < fromMs - 1 || !cl.startsWithKeyframe) continue;
          clipStart = absMs;
          started = true;
        }
        const rel = Math.max(0, Math.round(absMs - clipStart));
        // The segments overlap by a moment; drop any frame the next segment
        // also has, so the timeline never runs backwards at a seam.
        const kids = next
          ? cl.children.filter((c) => {
              const t = blockRelTime(c);
              return t === null || seg.startMs + (cl.timecode + t) * scaleMs < next.startMs;
            })
          : cl.children;
        if (!kids.length) continue;
        const body = Buffer.concat([uintEl(ID.Timecode, rel), ...kids]);
        const clusterPos = written - segDataStart;
        await write(Buffer.concat([idBytes(ID.Cluster), sizeBytes(body.length), body]));
        if (cl.startsWithKeyframe && header.videoTrack !== null) cues.push({ time: rel, pos: clusterPos });
        lastEnd = absMs;
      }
      // The first segment can end before any keyframe past fromMs; fall back to
      // its first keyframe rather than producing nothing.
      if (!started && i === usable.length - 1) throw new Error("The recording had no usable video yet.");
    }
    if (!header || clipStart === null) throw new Error("The recording had no usable video yet.");

    const durationMs = Math.max(1, lastEnd - clipStart);
    const cuesPos = written - segDataStart;
    const cuePoints = cues.map((c) =>
      el(ID.CuePoint, Buffer.concat([uintEl(ID.CueTime, c.time), el(ID.CueTrackPositions, Buffer.concat([uintEl(ID.CueTrack, header.videoTrack), uintEl(ID.CueClusterPosition, c.pos)]))]))
    );
    await write(el(ID.Cues, Buffer.concat(cuePoints)));

    // Patch the placeholders.
    const segSize = written - segDataStart;
    await fh.write(sizeBytes(segSize, 8), 0, 8, segSizePos);
    const posBuf = Buffer.alloc(8);
    posBuf.writeBigUInt64BE(BigInt(cuesPos));
    await fh.write(posBuf, 0, 8, seekHeadCuesPos);
    const durBuf = Buffer.alloc(8);
    durBuf.writeDoubleBE(durationMs);
    await fh.write(durBuf, 0, 8, header.durationPos);
    return { durationMs };
  } finally {
    await fh.close();
  }
}

module.exports = { joinSegments, parseSegment, readSize, sizeBytes, readId };
