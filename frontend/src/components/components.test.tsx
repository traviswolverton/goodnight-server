import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StatusPill } from '@/components/status-pill'
import { VariablesPanel } from '@/components/variables-panel'

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
    for (const label of ['OK', 'Warning', 'Down', 'Unknown']) expect(screen.getByText(label)).toBeInTheDocument()
  })
})

describe('<VariablesPanel>', () => {
  const context = {
    device: { temperature_c: 21.5, lux: 3.5, screen: '<img src=x onerror=alert(1)>' },
    extra: { nested: { 'light.desk': { state: 'on' } } },
  }

  it('groups by top-level name, expands level by level, and inserts the full path', async () => {
    const user = userEvent.setup()
    const onInsert = vi.fn()
    render(<VariablesPanel open onOpenChange={vi.fn()} context={context} target="the state" onInsert={onInsert} />)
    expect(screen.getByRole('heading', { name: 'Variables for the state' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /extra/ }))
    await user.click(screen.getByRole('button', { name: /nested/ }))
    await user.click(screen.getByRole('button', { name: /light\.desk/ }))
    await user.click(screen.getByRole('button', { name: "Insert extra.nested['light.desk'].state" }))
    expect(onInsert).toHaveBeenCalledWith("extra.nested['light.desk'].state")
  })

  it('filters to a flat list, and says when nothing matches', async () => {
    const user = userEvent.setup()
    render(<VariablesPanel open onOpenChange={vi.fn()} context={context} onInsert={vi.fn()} />)
    await user.type(screen.getByLabelText('Filter variables'), 'temp')
    expect(screen.getByRole('button', { name: 'Insert device.temperature_c' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /extra/ })).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Filter variables'))
    await user.type(screen.getByLabelText('Filter variables'), 'zzz')
    expect(screen.getByText(/No variables match/)).toBeInTheDocument()
  })

  it('copies instead of inserting when read-only', async () => {
    const user = userEvent.setup()
    render(<VariablesPanel open onOpenChange={vi.fn()} context={context} />)
    await user.type(screen.getByLabelText('Filter variables'), 'lux')
    expect(screen.getByRole('button', { name: 'Copy device.lux' })).toBeInTheDocument()
  })

  it('renders hostile values as text, never HTML', async () => {
    const user = userEvent.setup()
    render(<VariablesPanel open onOpenChange={vi.fn()} context={context} onInsert={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /device/ }))
    expect(document.querySelector('[role=dialog] img')).toBeNull()
    expect(screen.getByRole('dialog')).toHaveTextContent('<img src=x onerror=alert(1)>')
  })

  it('explains an empty context', () => {
    render(<VariablesPanel open onOpenChange={vi.fn()} context={{}} />)
    expect(screen.getByText(/Nothing to show yet/)).toBeInTheDocument()
  })
})
