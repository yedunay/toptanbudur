/**
 * Magic-byte (file signature) verification for PDF uploads. Browsers can spoof
 * the MIME type in multipart/form-data, so we re-derive the format from the
 * first bytes of the buffer. Anything that does NOT start with the PDF header
 * ("%PDF-") is rejected. Mirrors the image detector (image-magic-bytes.ts) but
 * kept separate so image-only upload paths remain unchanged.
 *
 * Reference signature:
 *   PDF : 25 50 44 46 2D   ("%PDF-")
 */

export interface DetectedPdf {
  mimetype: 'application/pdf';
  extension: 'pdf';
}

const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/**
 * Returns the detected PDF mimetype/extension or null when the buffer is not a
 * PDF. Caller should treat null as a 400 error.
 */
export function detectPdf(buf: Buffer): DetectedPdf | null {
  if (!buf || buf.length < PDF_SIG.length) return null;
  for (let i = 0; i < PDF_SIG.length; i += 1) {
    if (buf[i] !== PDF_SIG[i]) return null;
  }
  return { mimetype: 'application/pdf', extension: 'pdf' };
}
