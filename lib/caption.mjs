import { MetaApiError } from './errors.mjs';
import { defaultMetaClient } from './meta.mjs';
import { CAPTION_SYSTEM, CAPTION_INSTRUCTION } from './prompts.mjs';

// Image captioning through Muse Spark vision on Meta Model API.
// Same transport and honesty rules as OCR: no Meta key, no caption.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** @param {string} name */
export function mimeForImageFile(name) {
  const m = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return (m && IMAGE_MIME_BY_EXT[m[0]]) || null;
}

const SUPPORTED_MIMES = new Set(Object.values(IMAGE_MIME_BY_EXT));

/**
 * @param {Buffer|Uint8Array} bytes
 * @param {{ mime?: string, visionImpl?: Function, client?: any }} [opts]
 * @returns {Promise<string>} the caption text
 */
export async function captionImage(bytes, { mime, visionImpl, client } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buf.length) throw new MetaApiError('Image is empty. Choose an image file first.');
  if (buf.length > MAX_IMAGE_BYTES) throw new MetaApiError(`Image is too large (${buf.length} bytes). Keep it under ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`);
  if (!SUPPORTED_MIMES.has(mime)) throw new MetaApiError(`Unsupported image type: ${mime || 'unknown'}. Use PNG, JPEG, WebP, or GIF.`);
  const vision = visionImpl || ((args) => (client || defaultMetaClient()).vision(args));
  const caption = String(await vision({
    imageBase64: buf.toString('base64'),
    mime,
    system: CAPTION_SYSTEM,
    instruction: CAPTION_INSTRUCTION,
  }) || '').trim();
  if (!caption) throw new MetaApiError('Meta vision returned no caption for this image.');
  return caption;
}
