import { cn } from '@/lib/utils'

/** The Desk Dashboard mark: three "pixels" in a rounded square (same as the favicon). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <circle cx="8.5" cy="16" r="2.6" className="fill-primary-foreground" />
      <circle cx="16" cy="16" r="2.6" className="fill-primary-foreground" fillOpacity=".8" />
      <circle cx="23.5" cy="16" r="2.6" className="fill-primary-foreground" fillOpacity=".55" />
    </svg>
  )
}
