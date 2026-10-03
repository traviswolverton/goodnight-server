import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DiagnosticsResponse } from '@/lib/types'
import { DiagnosticsView } from '@/routes/diagnostics'

const base: DiagnosticsResponse = {
  now: 1000,
  online: true,
  link_connected: true,
  diagnostics: {
    firmware: 'Oct  3 2026 14:55:13',
    uptime_s: 7,
    heap_free: 146316,
    setup_mode: false,
    wifi: { rssi: -45, ip: '192.0.2.87' },
    hardware: { oled: true, light: true, expander: true, joystick: true, climate: true },
    stick: { x: 1910, y: 1902, direction: 'none', pressed: false },
    buttons_down: [],
  },
  diagnostics_age_seconds: 1,
  sensors: { temperature_c: 21.5, humidity: 44, lux: null, screen: 'full' },
  sensors_age_seconds: 1,
  presses: [],
  stick_events: [],
  sounds: ['armed', 'running', 'success', 'failure', 'cancel'],
}

function show(over: Partial<DiagnosticsResponse> = {}, canEdit = true) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <DiagnosticsView data={{ ...base, ...over }} canEdit={canEdit} />
    </QueryClientProvider>,
  )
}

function withHardware(hardware: Partial<NonNullable<DiagnosticsResponse['diagnostics']>['hardware']>) {
  return { ...base.diagnostics!, hardware: { ...base.diagnostics!.hardware!, ...hardware } }
}

describe('DiagnosticsView', () => {
  it('shows a healthy device as reporting with everything answering', () => {
    show()
    expect(screen.getByText('Reporting')).toBeInTheDocument()
    expect(screen.getByText('All answering')).toBeInTheDocument()
    expect(screen.getByText('192.0.2.87')).toBeInTheDocument()
    expect(screen.getByText('-45 dBm')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('makes a part that didn’t answer prominent, with what to check', () => {
    show({ diagnostics: withHardware({ expander: false, climate: false }) })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Button reader, Temperature and humidity: not answering')
    expect(screen.getByText('2 not answering')).toBeInTheDocument()
    const checks = within(screen.getByRole('list', { name: 'Hardware checks' }))
    expect(checks.getByText(/the 8 buttons and the stick press can’t be read/)).toBeInTheDocument()
    expect(checks.getAllByText('Answering')).toHaveLength(3)
  })

  it('says “No reading” for a sensor that has none', () => {
    show()
    expect(screen.getByText('21.5 °C')).toBeInTheDocument()
    expect(screen.getByText('No reading')).toBeInTheDocument()
  })

  it('lights held and just-pressed buttons', () => {
    show({
      diagnostics: { ...base.diagnostics!, buttons_down: [2] },
      presses: [{ button: 5, press: 'long', at: 999, action: null, ok: null, text: null }],
    })
    expect(screen.getByLabelText('Button 2: held')).toBeInTheDocument()
    expect(screen.getByLabelText('Button 5: long press')).toBeInTheDocument()
    expect(screen.getByLabelText('Button 1: idle')).toBeInTheDocument()
    expect(screen.getByText(/Last press: button 5, long, 1 s ago/)).toBeInTheDocument()
  })

  it('does not keep a press lit after it has faded', () => {
    show({ presses: [{ button: 5, press: 'short', at: 990, action: null, ok: null, text: null }] })
    expect(screen.getByLabelText('Button 5: idle')).toBeInTheDocument()
  })

  it('lights the joystick direction and press from the report and from events', () => {
    show({
      diagnostics: { ...base.diagnostics!, stick: { x: 3900, y: 1900, direction: 'right', pressed: false } },
      stick_events: [{ stick: 'press', at: 999.5 }],
    })
    expect(screen.getByLabelText('right: on')).toBeInTheDocument()
    expect(screen.getByLabelText('up: off')).toBeInTheDocument()
    expect(screen.getByLabelText('press: on')).toBeInTheDocument()
    expect(screen.getByText('3900')).toBeInTheDocument()
  })

  it('says so when there is no joystick', () => {
    show({ diagnostics: { ...withHardware({ joystick: false }), stick: { x: null, y: null, direction: 'none', pressed: false } } })
    expect(screen.getByText(/The device says the axes aren’t answering/)).toBeInTheDocument()
  })

  it('treats a stale report as “not reporting”, not as the current state', () => {
    show({ diagnostics_age_seconds: 400 })
    expect(screen.getByText('Not reporting')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/isn’t reporting.*last report/)
  })

  it('treats the retained copy replayed on connect as not current', () => {
    show({ diagnostics_age_seconds: null })
    expect(screen.getByText('Waiting for a new report')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/from before the server connected/)
  })

  it('shows only the note before the device has ever reported', () => {
    show({ diagnostics: null, diagnostics_age_seconds: null })
    expect(screen.getByText('No report yet')).toBeInTheDocument()
    expect(screen.queryByText('Hardware')).toBeNull()
  })

  it('offers the sound test to editors only', () => {
    show()
    expect(screen.getByText('Sound test')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Play the/ })).toHaveLength(5)
  })

  it('hides the sound test from viewers', () => {
    show({}, false)
    expect(screen.queryByText('Sound test')).toBeNull()
  })
})
