import { useEffect, useState } from 'react'

export function useGhostMarks(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let gone = false
    void window.api.ghostMarks().then((value) => {
      if (!gone) setOn(value)
    })
    const stop = window.api.onGhostMarks(setOn)
    return () => {
      gone = true
      stop()
    }
  }, [])
  return on
}
