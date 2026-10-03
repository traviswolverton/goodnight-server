import { describe, expect, it } from 'vitest'
import { axisPercent, eventAge, heapLabel, reportStatus, signalWord, staleNote } from '@/lib/diagnostics'
import type { DiagnosticsResponse } from '@/lib/types'

const report: DiagnosticsResponse['diagnostics'] = {
  firmware: 'Oct  3 2026 14:55:13',
  uptime_s: 7,
  heap_free: 146316,
  setup_mode: false,
  wifi: { rssi: -45, ip: '192.0.2.87' },
  hardware: { oled: true, light: true, expander: true, joystick: true, climate: true },
  stick: { x: 1910, y: 1902, direction: 'none', pressed: false },
  buttons_down: [],
}

function data(over: Partial<DiagnosticsResponse> = {}): DiagnosticsResponse {
  return {
    now: 1000,
    online: true,
    link_connected: true,
    diagnostics: report,
    diagnostics_age_seconds: 2,
    sensors: null,
    sensors_age_seconds: null,
    presses: [],
    stick_events: [],
    sounds: [],
    ...over,
  }
}

describe('reportStatus', () => {
  it('is live for a recent report from an online device', () => {
    expect(reportStatus(data())).toEqual({ status: 'ok', label: 'Reporting', live: true })
    expect(staleNote(data(), 1000)).toBeNull()
  })

  it('is not live for a report that could be old', () => {
    expect(reportStatus(data({ diagnostics_age_seconds: 200 }))).toMatchObject({ status: 'down', label: 'Not reporting', live: false })
    expect(reportStatus(data({ online: false }))).toMatchObject({ status: 'down', label: 'Offline', live: false })
    // The retained copy replayed on connect: it has no age, so it must not look current.
    expect(reportStatus(data({ diagnostics_age_seconds: null }))).toMatchObject({ status: 'unknown', live: false })
  })

  it('says why in words', () => {
    expect(staleNote(data({ diagnostics_age_seconds: 200 }), 1000)).toMatch(/isn’t reporting.*3 min ago/)
    expect(staleNote(data({ diagnostics: null, diagnostics_age_seconds: null }), 1000)).toMatch(/hasn’t sent a report/)
    expect(staleNote(data({ diagnostics_age_seconds: null }), 1000)).toMatch(/from before the server connected/)
    expect(staleNote(data({ link_connected: false }), 1000)).toMatch(/can’t reach the broker/)
  })

  it('puts the broker problem first', () => {
    expect(reportStatus(data({ link_connected: false, diagnostics: null })).label).toBe('Server not connected to the broker')
  })
})

describe('readouts', () => {
  it('words the signal', () => {
    expect([-45, -60, -70, -85, null].map(signalWord)).toEqual(['strong', 'good', 'fair', 'weak', null])
  })
  it('formats memory and event age', () => {
    expect(heapLabel(146316)).toBe('143 KB free')
    expect(heapLabel(null)).toBe('—')
    expect(eventAge(data({ now: 1000 }), 999)).toBe(1)
    expect(eventAge(data({ now: 1000 }), 1005)).toBe(0)
  })
  it('places a raw reading along its track', () => {
    expect(axisPercent(0)).toBe(0)
    expect(axisPercent(4095)).toBe(100)
    expect(axisPercent(5000)).toBe(100)
    expect(axisPercent(null)).toBeNull()
  })
})
