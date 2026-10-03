import { BedDouble, BookOpen, Grid2x2, LayoutDashboard, Palette, Radio, Settings2, Stethoscope, ToggleRight, Users, type LucideIcon } from 'lucide-react'
import type { Role } from '@/lib/auth'

export interface NavItem {
  to: '/' | '/device' | '/diagnostics' | '/actions' | '/buttons' | '/settings' | '/appearance' | '/users' | '/mqtt' | '/about'
  label: string
  icon: LucideIcon
  adminOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/device', label: 'Device', icon: BedDouble },
  { to: '/diagnostics', label: 'Diagnostics', icon: Stethoscope },
  { to: '/actions', label: 'Actions', icon: ToggleRight },
  { to: '/buttons', label: 'Buttons', icon: Grid2x2 },
  { to: '/settings', label: 'Settings', icon: Settings2, adminOnly: true },
  { to: '/appearance', label: 'Appearance', icon: Palette },
  { to: '/users', label: 'Users', icon: Users, adminOnly: true },
  { to: '/mqtt', label: 'MQTT reference', icon: Radio },
  { to: '/about', label: 'About', icon: BookOpen },
]

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin')
}
