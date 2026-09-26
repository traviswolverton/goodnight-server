/** Plain-language labels for audit-log actions. The raw action name stays
 *  available (as a tooltip) for anyone correlating with server logs. */
const LABELS: Record<string, string> = {
  'login.success': 'Signed in',
  'login.failed': 'Failed sign-in attempt',
  'login.blocked': 'Sign-in blocked (too many attempts)',
  logout: 'Signed out',
  'password.change': 'Changed their password',
  'user.bootstrap': 'First administrator created',
  'user.create': 'Created a user',
  'user.update': 'Changed a user',
  'user.delete': 'Deleted a user',
  'user.reset_password': 'Reset a user’s password',
  'api.save': 'Saved a card’s text',
  'api.save_status': 'Saved a card’s status',
  'api.save_title': 'Saved a card’s title',
  'api.save_render': 'Showed or hid a card',
  'api.save_pixel_color': 'Saved a pixel’s colour',
  'api.add_adapter_endpoint': 'Added an adapter',
  'api.update_adapter_endpoint': 'Edited an adapter',
  'api.remove_adapter_endpoint': 'Removed an adapter',
  'api.test_adapter': 'Tested an adapter connection',
  'api.restart_app': 'Restarted the app',
  'api.generate_lines': 'Asked AI for card text',
  'api.generate_status': 'Asked AI for a status template',
  'api.generate_pixel_color': 'Asked AI for a pixel colour',
}

export function describeAction(action: string): string {
  return LABELS[action] ?? action
}
