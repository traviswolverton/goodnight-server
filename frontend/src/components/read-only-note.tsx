import { Eye } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function ReadOnlyNote() {
  return (
    <Alert className="mb-4">
      <Eye aria-hidden="true" />
      <AlertDescription>You have read-only access. You can look around and preview, but not save changes.</AlertDescription>
    </Alert>
  )
}
