import { BedDouble, Grid2x2, LayoutDashboard, Radio, Settings2, ToggleRight, Users, type LucideIcon } from 'lucide-react'
import type { Role } from '@/lib/auth'

export interface NavItem {
  to: '/' | '/device' | '/actions' | '/buttons' | '/settings' | '/users' | '/mqtt'
  label: string
  icon: LucideIcon
  adminOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/device', label: 'Device', icon: BedDouble },
  { to: '/actions', label: 'Actions', icon: ToggleRight },
  { to: '/buttons', label: 'Buttons', icon: Grid2x2 },
  { to: '/settings', label: 'Settings', icon: Settings2, adminOnly: true },
  { to: '/users', label: 'Users', icon: Users, adminOnly: true },
  { to: '/mqtt', label: 'MQTT reference', icon: Radio },
]

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin')
}
