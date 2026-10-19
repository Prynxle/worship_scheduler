/**
 * Save a Blob to disk through a temporary object URL.
 *
 * The URL is revoked on a LATER turn rather than synchronously after
 * `click()`. The browser reads the blob through that URL when it starts the
 * download; revoking it in the same task can beat that read in some engines and
 * cancel the file. Deferring past the current task lets the browser consume the
 * bytes first, after which the URL is no longer needed.
 *
 * Browser-only: call it from an event handler, never during render.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
