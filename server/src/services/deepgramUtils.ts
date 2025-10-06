/**
 * Utility helpers for Deepgram service interactions
 * Centralizes remote-audio validation and fetching logic so multiple modules
 * can reuse the same behavior and error shapes.
 */
export async function validateAndFetch(
  url: string,
  options?: { maxSizeBytes?: number; tolerateMissing?: boolean }
): Promise<Buffer | null> {
  const MAX_SIZE = options?.maxSizeBytes ?? 50 * 1024 * 1024; // 50MB default
  const tolerateMissing = !!options?.tolerateMissing;

  const res = await fetch(url);
  if (!res.ok) {
    // If caller requested tolerant behavior, return null for 404/not-found or other remote issues
    if (tolerateMissing) {
      return null;
    }

    const err: any = new Error(`Remote server returned ${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('audio/') && !contentType.includes('octet-stream')) {
    // If tolerant, return null so callers (startup checks) can handle gracefully
    if (tolerateMissing) {
      return null;
    }

    const bodyPreview = await res.text().then(t => t.slice(0, 200)).catch(() => '');
    const err: any = new Error(`Remote content type not audio: ${contentType}` + (bodyPreview ? ` - body:${bodyPreview}` : ''));
    err.status = res.status;
    err.contentType = contentType;
    throw err;
  }

  const contentLength = res.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_SIZE) {
    if (tolerateMissing) {
      return null;
    }

    const err: any = new Error('Remote content too large');
    err.status = res.status;
    throw err;
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
