import { useEffect, useState } from 'react'

/** Current unix time in seconds, refreshed on an interval (for "12 s ago" labels). */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
