/**
 * Magic-byte (file signature) verification for image uploads. Browsers can
 * easily spoof MIME types in multipart/form-data, so we re-derive the format
 * by inspecting the first few bytes of the buffer. Anything that does NOT
 * match jpeg/png/webp is rejected.
 *
 * Reference signatures:
 *   JPEG : FF D8 FF
 *   PNG  : 89 50 4E 47 0D 0A 1A 0A
 *   WEBP : "RIFF" .... "WEBP"  (4-byte size between)
 */

export type AllowedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export type AllowedImageExt = 'jpg' | 'png' | 'webp';

export interface DetectedImage {
  mimetype: AllowedImageMime;
  extension: AllowedImageExt;
}

const JPEG_SIG = [0xff, 0xd8, 0xff];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Returns the detected image mimetype/extension or null when the buffer is
 * not a supported image. Caller should treat null as a 400 error.
 */
export function detectImage(buf: Buffer): DetectedImage | null {
  if (!buf || buf.length < 12) return null;

  if (startsWith(buf, JPEG_SIG)) {
    return { mimetype: 'image/jpeg', extension: 'jpg' };
  }
  if (startsWith(buf, PNG_SIG)) {
    return { mimetype: 'image/png', extension: 'png' };
  }
  // WEBP: "RIFF????WEBP"
  if (
    buf[0] === 0x52 && // R
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x46 && // F
    buf[8] === 0x57 && // W
    buf[9] === 0x45 && // E
    buf[10] === 0x42 && // B
    buf[11] === 0x50 // P
  ) {
    return { mimetype: 'image/webp', extension: 'webp' };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Geniş medya tespiti — destek talepleri + konuşma ekleri             */
/* ------------------------------------------------------------------ */

/**
 * Destek yüzeylerinde (talep açma, bayi↔destek sohbeti) foto VE video kabul
 * edilir (kullanıcı kararı 2026-08-02: iPhone HEIC fotoğrafları ve videolar
 * sessizce reddedildiği için bayiler hiç ek yükleyemiyordu). Ürün görseli /
 * avatar / popup gibi görüntülenmesi şart yüzeyler `detectImage` ile
 * SINIRLI kalır — oralara video/HEIC sokma.
 */
export interface DetectedMedia {
  mimetype: string;
  extension: string;
  kind: 'image' | 'video';
}

/** ISO-BMFF (ftyp) major brand → medya türü eşlemesi. */
function detectFtyp(buf: Buffer): DetectedMedia | null {
  // "ftyp" 4. bayttan başlar; ilk 4 bayt box uzunluğudur.
  if (
    buf.length < 12 ||
    buf[4] !== 0x66 || // f
    buf[5] !== 0x74 || // t
    buf[6] !== 0x79 || // y
    buf[7] !== 0x70 // p
  ) {
    return null;
  }
  const brand = buf.subarray(8, 12).toString('latin1').toLowerCase();
  if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(brand)) {
    return { mimetype: 'image/heic', extension: 'heic', kind: 'image' };
  }
  if (/^(avif|avis)/.test(brand)) {
    return { mimetype: 'image/avif', extension: 'avif', kind: 'image' };
  }
  if (/^qt/.test(brand)) {
    return { mimetype: 'video/quicktime', extension: 'mov', kind: 'video' };
  }
  // isom / iso2 / mp41 / mp42 / mp4v / m4v* / avc1 / 3gp* / dash ... → mp4 ailesi
  return { mimetype: 'video/mp4', extension: 'mp4', kind: 'video' };
}

/**
 * Magic-byte ile geniş medya tespiti. null → desteklenmeyen tür (400).
 * Görseller: JPEG/PNG/WEBP/GIF/HEIC/AVIF · Videolar: MP4(+MOV/3GP)/WEBM/MKV/AVI.
 */
export function detectMedia(buf: Buffer): DetectedMedia | null {
  if (!buf || buf.length < 12) return null;

  const img = detectImage(buf);
  if (img) return { ...img, kind: 'image' };

  // GIF87a / GIF89a
  if (
    buf[0] === 0x47 && // G
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x38 // 8
  ) {
    return { mimetype: 'image/gif', extension: 'gif', kind: 'image' };
  }

  const ftyp = detectFtyp(buf);
  if (ftyp) return ftyp;

  // EBML (WebM / Matroska) — DocType ayrımı için ilk 64 baytta "webm" ara.
  if (
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  ) {
    const head = buf.subarray(0, 64).toString('latin1');
    return head.includes('webm')
      ? { mimetype: 'video/webm', extension: 'webm', kind: 'video' }
      : { mimetype: 'video/x-matroska', extension: 'mkv', kind: 'video' };
  }

  // AVI: "RIFF????AVI "
  if (
    buf[0] === 0x52 && // R
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x46 && // F
    buf[8] === 0x41 && // A
    buf[9] === 0x56 && // V
    buf[10] === 0x49 // I
  ) {
    return { mimetype: 'video/x-msvideo', extension: 'avi', kind: 'video' };
  }

  return null;
}
