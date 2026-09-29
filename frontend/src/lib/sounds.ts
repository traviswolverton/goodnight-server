import type { SoundName } from '@/lib/types'

/** The device's sounds, in the order you'd hear them in a confirmed action.
 *  The names are the contract with the firmware (DESIGN.md, "Button feedback"). */
export const SOUND_ORDER: SoundName[] = ['armed', 'running', 'success', 'failure', 'cancel']

/** `when` is the full sentence for guides; `short` fits a list row. */
export const SOUND_INFO: Record<SoundName, { name: string; when: string; short: string; play: string }> = {
  armed: { short: 'Press again to run it', name: 'Armed', when: 'One mid beep: the first press of an action that asks to confirm. Press again to go ahead.', play: 'Armed — press again' },
  running: { short: 'Sending to Home Assistant', name: 'Running', when: 'Two quick rising beeps: it’s being sent to Home Assistant.', play: 'Sending' },
  success: { short: 'Done', name: 'Success', when: 'Three rising notes: done, and verified if the action has a check.', play: 'Done' },
  failure: { short: 'Failed or timed out', name: 'Failure', when: 'A low falling buzz: it failed, timed out, or the check never passed.', play: 'Failed' },
  cancel: { short: 'Armed action cancelled', name: 'Cancel', when: 'One soft blip: an armed action timed out or was cancelled.', play: 'Cancelled' },
}
