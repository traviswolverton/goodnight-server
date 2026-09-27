import { BedDouble, Cable, LayoutDashboard, Radio, Rows3, Sparkles, ToggleRight, Users, type LucideIcon } from 'lucide-react'
import type { Role } from '@/lib/auth'

export interface NavItem {
  to: '/' | '/device' | '/cards' | '/pixels' | '/actions' | '/adapters' | '/users' | '/mqtt'
  label: string
  icon: LucideIcon
  adminOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/device', label: 'Device', icon: BedDouble },
  { to: '/cards', label: 'Cards', icon: Rows3 },
  { to: '/pixels', label: 'Pixels', icon: Sparkles },
  { to: '/actions', label: 'Actions', icon: ToggleRight },
  { to: '/adapters', label: 'Adapters', icon: Cable, adminOnly: true },
  { to: '/users', label: 'Users', icon: Users, adminOnly: true },
  { to: '/mqtt', label: 'MQTT reference', icon: Radio },
]

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin')
}
