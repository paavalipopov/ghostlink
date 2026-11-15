const ACTIVE = new Set(['starting', 'scaling', 'waiting', 'stopping'])

export function selectionRejected(message: string): boolean {
  return /pick a window|selected window changed|unsuitable|current drag/i.test(message)
}

export function fullscreenToggleModel(input: {
  state: string
  error: string | null
  windowTracked: boolean
  busy: boolean
  marking: boolean
}): { pressed: boolean; enabled: boolean; status: 'on' | 'off'; title: string } {
  const pressed = ACTIVE.has(input.state)
  const enabled = input.busy
    ? false
    : pressed || (input.windowTracked && !input.marking && input.state !== 'unavailable')
  const title = pressed
    ? 'Exit fullscreen (Alt+Shift+A). Ctrl+Alt+F11 also exits while capture is running.'
    : input.windowTracked && !input.marking
      ? 'Scale the picked window (Alt+Shift+A).'
      : 'Pick a window before fullscreen. Alt+Shift+A uses that window. A dragged frame or an entire display only shares pointers.'
  return {
    pressed,
    enabled,
    status: pressed ? 'on' : 'off',
    title: input.error ? `${title} ${input.error}` : title
  }
}
