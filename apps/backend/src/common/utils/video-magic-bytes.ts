/**
 * Magic-byte (file signature) verification for video uploads — the video twin
 * of image-magic-bytes.ts. Browsers can spoof the multipart MIME type, so we
 * re-derive the format from the buffer's first bytes. Anything that is NOT a
 * supported web video container is rejected.
 *
 * Reference signatures:
 *   MP4 / MOV / M4V : bytes 4..8 == "ftyp"  (ISO Base Media; box-prefixed)
 *   WEBM / MKV      : 1A 45 DF A3            (EBML header)
 *
 * Only mp4 + webm are accepted — the two formats <video> plays everywhere.
 */

export type AllowedVideoMime = 'video/mp4' | 'video/webm';
export type AllowedVideoExt = 'mp4' | 'webm';

export interface DetectedVideo {
  mimetype: AllowedVideoMime;
  extension: AllowedVideoExt;
}

const EBML_SIG = [0x1a, 0x45, 0xdf, 0xa3];

function startsWith(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Returns the detected video mimetype/extension or null when the buffer is not
 * a supported web video. Caller should treat null as a 400 error.
 */
export function detectVideo(buf: Buffer): DetectedVideo | null {
  if (!buf || buf.length < 12) return null;

  // WEBM/MKV: EBML header.
  if (startsWith(buf, EBML_SIG)) {
    return { mimetype: 'video/webm', extension: 'webm' };
  }

  // MP4/MOV/M4V: an ISO-BMFF "ftyp" box. The 4-byte big-endian box size comes
  // first, then the "ftyp" fourCC at offset 4. We don't trust the size; just
  // look for the marker.
  if (
    buf[4] === 0x66 && // f
    buf[5] === 0x74 && // t
    buf[6] === 0x79 && // y
    buf[7] === 0x70 // p
  ) {
    return { mimetype: 'video/mp4', extension: 'mp4' };
  }

  return null;
}
