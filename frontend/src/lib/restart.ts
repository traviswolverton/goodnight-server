/** Waits out an app restart (POST /api/restart, or a save that restarts on
 *  its own): Docker brings the container back, so poll /healthz until the
 *  new process answers. Resolves false if it hasn't after a minute. */
export async function waitForRestart(): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try {
      const response = await fetch('/healthz', { cache: 'no-store' })
      if (response.ok && i > 1) return true // i > 1: skip the not-yet-stopped instance
    } catch {
      // Still down; keep waiting.
    }
  }
  return false
}
