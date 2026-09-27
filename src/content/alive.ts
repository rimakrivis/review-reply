/**
 * False once the extension was reloaded or removed. Google tabs opened before that still run the old copy of
 * this script, which can no longer use chrome.* APIs ("Extension context invalidated"); it should stop quietly.
 */
export function extensionAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}
