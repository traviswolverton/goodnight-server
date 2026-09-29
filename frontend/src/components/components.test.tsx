import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AdapterFields, TestResult } from '@/components/adapter-form'
import { DevicePreview } from '@/components/device-preview'
import { ExplainedStatusPill, StatusPill } from '@/components/status-pill'
import { VariablesPanel } from '@/components/variables-panel'
import type { AdapterType } from '@/lib/types'

describe('<DevicePreview>', () => {
  it('shows the title and only the first four lines, and describes itself for screen readers', () => {
    render(<DevicePreview title="AdGuard" lines={['one', 'two', 'three', 'four', 'five']} status="warn" />)
    const preview = screen.getByRole('img')
    expect(preview).toHaveAttribute('aria-label', 'Display preview: AdGuard, status warn. one. two. three. four')
    expect(preview).toHaveTextContent('AdGuard')
    expect(preview).toHaveTextContent('four')
    expect(preview).not.toHaveTextContent('five')
  })
})

describe('<StatusPill>', () => {
  it('always carries a text label, never colour alone', () => {
    render(
      <>
        <StatusPill status="ok" />
        <StatusPill status="warn" />
        <StatusPill status="down" />
        <StatusPill status="unknown" />
      </>,
    )
    for (const label of ['OK', 'Warning', 'Down', 'Not polled yet']) expect(screen.getByText(label)).toBeInTheDocument()
  })
})

describe('<VariablesPanel>', () => {
  const context = {
    adapters: {
      adguard_main: { status: 'ok', percent_blocked: 12, host: '<img src=x onerror=alert(1)>' },
      home_assistant: { status: 'warn', entities: { 'light.desk': { state: 'on' } } },
    },
  }

  it('groups by adapter, expands level by level, and inserts the full path', async () => {
    const user = userEvent.setup()
    const onInsert = vi.fn()
    render(<VariablesPanel open onOpenChange={vi.fn()} context={context} target="line 1" onInsert={onInsert} />)
    expect(screen.getByRole('heading', { name: 'Variables for line 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /home_assistant/ }))
    await user.click(screen.getByRole('button', { name: /entities/ }))
    await user.click(screen.getByRole('button', { name: /light\.desk/ }))
    await user.click(screen.getByRole('button', { name: "Insert adapters.home_assistant.entities['light.desk'].state" }))
    expect(onInsert).toHaveBeenCalledWith("adapters.home_assistant.entities['light.desk'].state")
  })

  it('filters to a flat list, and says when nothing matches', async () => {
    const user = userEvent.setup()
    render(<VariablesPanel open onOpenChange={vi.fn()} context={context} onInsert={vi.fn()} />)
    await user.type(screen.getByLabelText('Filter variables'), 'percent')
    expect(screen.getByRole('button', { name: 'Insert adapters.adguard_main.percent_blocked' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /home_assistant/ })).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Filter variables'))
    await user.type(screen.getByLabelText('Filter variables'), 'zzz')
    expect(screen.getByText(/No variables match/)).toBeInTheDocument()
  })

  it('copies instead of inserting when read-only', async () => {
    const user = userEvent.setup()
    render(<VariablesPanel open onOpenChange={vi.fn()} context={context} />)
    await user.type(screen.getByLabelText('Filter variables'), 'percent')
    expect(screen.getByRole('button', { name: 'Copy adapters.adguard_main.percent_blocked' })).toBeInTheDocument()
  })

  it('renders hostile values as text, never HTML', async () => {
    const user = userEvent.setup()
    render(<VariablesPanel open onOpenChange={vi.fn()} context={context} onInsert={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /adguard_main/ }))
    expect(document.querySelector('[role=dialog] img')).toBeNull()
    expect(screen.getByRole('dialog')).toHaveTextContent('<img src=x onerror=alert(1)>')
  })

  it('explains an empty context', () => {
    render(<VariablesPanel open onOpenChange={vi.fn()} context={{}} />)
    expect(screen.getByText(/No adapters have completed a poll yet/)).toBeInTheDocument()
  })
})

describe('<AdapterFields>', () => {
  const spec: AdapterType = {
    type: 'adguard',
    description: 'x',
    required_fields: [
      { name: 'base_url', label: 'Base URL', placeholder: 'http://dns.example.lan' },
      { name: 'password', label: 'Password', secret: true },
      { name: 'verify_ssl', label: 'Verify TLS', type: 'checkbox', required: false },
    ],
  }

  it('renders one control per declared field; secrets are password inputs with an "unchanged" hint when already set', () => {
    render(
      <AdapterFields
        spec={spec}
        values={{ base_url: '', password: '', verify_ssl: true }}
        stored={{ password: { secret: true, set: true } }}
        onChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('Base URL')).toHaveAttribute('placeholder', 'http://dns.example.lan')
    const password = screen.getByLabelText(/Password/)
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('placeholder', 'unchanged — type to replace')
    expect(screen.getByRole('switch', { name: 'Verify TLS' })).toBeChecked()
  })

  it('reports edits as new values', async () => {
    const user = userEvent.setup()
    const changes: unknown[] = []
    render(<AdapterFields spec={spec} values={{ base_url: '', password: '', verify_ssl: true }} onChange={(v) => changes.push(v)} />)
    await user.type(screen.getByLabelText('Base URL'), 'h')
    expect(changes.at(-1)).toEqual({ base_url: 'h', password: '', verify_ssl: true })
    await user.click(screen.getByRole('switch', { name: 'Verify TLS' }))
    expect(changes.at(-1)).toEqual({ base_url: '', password: '', verify_ssl: false })
  })
})

describe('<TestResult>', () => {
  it('shows a failure clearly', () => {
    render(<TestResult result={{ ok: false, error: 'Connection refused' }} />)
    expect(screen.getByText(/Could not connect: Connection refused/)).toBeInTheDocument()
  })
  it('shows what came back on success', () => {
    render(<TestResult result={{ ok: true, status: 'ok', value: 42, unit: '%', detail: 'all good', summary: { version: '1.2' } }} />)
    expect(screen.getByText('Connected · status ok — 42 %')).toBeInTheDocument()
    expect(screen.getByText('all good')).toBeInTheDocument()
    expect(screen.getByText('version')).toBeInTheDocument()
  })
})

describe('ExplainedStatusPill', () => {
  it('opens the reason on a click (works on touch) and on hover', async () => {
    const user = userEvent.setup()
    render(<ExplainedStatusPill status="warn" reason="Home Assistant has no reading for: Garage." subject="home_assistant" />)
    const trigger = screen.getByRole('button', { name: 'home_assistant: Warning — why?' })
    await user.click(trigger)
    expect(await screen.findByText('Home Assistant has no reading for: Garage.')).toBeInTheDocument()
    await user.click(trigger) // a second click (after hovering) keeps it open
    expect(screen.getByText('Home Assistant has no reading for: Garage.')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('Home Assistant has no reading for: Garage.')).not.toBeInTheDocument())
    await user.unhover(trigger)
    await user.hover(trigger)
    expect(await screen.findByText('Home Assistant has no reading for: Garage.')).toBeInTheDocument()
  })

  it('is a plain pill when everything is fine', () => {
    render(<ExplainedStatusPill status="ok" reason={null} subject="kuma" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
  })
})
