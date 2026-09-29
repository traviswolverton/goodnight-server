# Plan: pixel-exact rendering of the device's screen on the server

**Status**: options written up, NOT decided and NOT implemented. Written up
2026-09-29 after a planning discussion. Two open questions below need
answers before any work starts — see "Open questions."

Nothing here has been run: the bedside device isn't built yet (no hardware,
no firmware flashed), so every claim about the panel is from the firmware
source (`bedside-dashboard-esp32`: `src/display.cpp`, `src/screen.cpp`,
`include/display.h`) and from how U8g2 works, not from a running unit.

## Why this exists

The screen is a 0.91" SSD1306 OLED: **128×32, 1-bit**, I2C, drawn with
U8g2's built-in bitmap fonts (today `u8g2_font_6x10_tf`: 21 characters by 3
lines, baselines at y = 8, 18, 28). The server will word what appears on it
(DESIGN.md's "on-screen confirmations": *"Press again: Close garage"*,
*"Failed: timed out"*), so it needs to know what that text will really look
like and whether it fits. It would also be good to see the screen in the web
UI, on the Device page.

"Pixel-exact" is realistic here because nothing is anti-aliased or hinted:
two renderers that use the same glyph bitmaps at the same integer positions
produce identical pixels. What can't be derived from pixels is the panel's
**level** (Off / Dim / Full are power-save, contrast and voltage settings,
not image content), so the UI has to fake those, and the panel's physical
look (pixel gaps, on-colour) is presentation: scale up with
nearest-neighbour, optionally draw a pixel grid.

## The options

### 1. Mirror the real framebuffer

The device publishes its 512-byte frame (about 700 bytes as base64) on a new
topic whenever the frame changes, rate-limited (say at most once a second).
The server keeps the latest and serves it; the Device page draws it scaled
up on a canvas.

- **Exact by definition**, including the one-pixel burn-in drift
  (`displayOffsetX/Y`), because it's the frame the panel got.
- No font or layout duplication anywhere.
- Small firmware change: read `u8g2.getBufferPtr()` in `displaySend()` and
  publish; one new topic, plus an ACL line for the device's account
  (`docs/mqtt-broker.md`).
- **Limits:** needs a running device, so it can't preview a message before
  it's sent, and can't be used to design layouts. Can't be validated until
  the hardware exists.

### 2. Render on the server with the same fonts

U8g2 fonts are compiled from ordinary BDF bitmap fonts (source BDFs are in
U8g2's repo, I believe under `tools/font/bdf/`; **not yet confirmed**, and
the exact glyph set of a `_tf` font needs checking against what
`bdfconv` emits). The server draws each glyph at the same baseline with the
font's own offsets and advance widths, e.g. with Pillow, into a 128×32
1-bit image. Bitmap fonts have no kerning or sub-pixel positioning, so this
should reproduce U8g2's text exactly.

- Works **now, with no hardware**, and is what lets the server check that a
  worded message fits (21 characters × 3 lines at 6×10) and preview it.
- Output can be PNG for the UI or the same 512-byte format option 1 uses,
  so the two can be compared byte for byte.
- **Limit:** the layout logic exists twice (firmware `screen.cpp` and the
  server), so it can drift. Icons (U8g2's icon fonts, planned) add another
  font to bring across. Mitigation: option 1's mirror, once available, is a
  check that the server's rendering equals the device's for the same input.

### 3. The server draws the screen (frame push)

The server composes the whole 512-byte frame and the device blits it
(`drawXBM`), so the preview *is* the output.

- One renderer; any layout, any icon source, no firmware release to change
  the design.
- **Costs:** the device still needs a local fallback for a power cut and for
  before Wi-Fi is up (DESIGN.md already brings the screen back with the right
  thresholds from NVS before Wi-Fi); a clock needs a frame per minute or a
  local clock; every change is a 512-byte MQTT message; burn-in drift and the
  dim/off levels stay device-side.
- **Hybrid worth considering:** the device keeps drawing its resting screen
  (clock, readings) and the server sends a frame only for transient messages
  (the confirmations), shown for a few seconds. Preview is then exact for
  exactly the part the server owns.

### Also considered

- **Run U8g2's C core on the server** (it has no hardware dependency; U8g2
  also ships an SDL simulator) with the firmware's draw functions compiled
  for the host, so the same code produces the frame. Exact and one source of
  layout truth, but it needs `screen.cpp` untangled from Arduino and a build
  step spanning two repos; heavy for one 128×32 panel. Revisit if the layout
  becomes complicated.
- **Render in the browser** (canvas with the same bitmap font): fine for the
  UI, but it isn't server side, so the server still couldn't check that a
  message fits.

## Recommendation

1. **Option 2 first**, because it needs no hardware and the confirmations
   are worded by the server. Deliverables: a small renderer module, a fit
   check (lines and columns) applied where the server words a message, and a
   scaled, pixel-gridded preview in the web UI.
2. **Option 1 once the device exists**: a live mirror on the Device page,
   which doubles as the proof that option 2 matches the real panel.
3. **Option 3 (or the hybrid)** only if the screen grows richer than text
   lines: icons, a designed layout, several screens.

Nothing in 1 and 2 blocks 3 later: the 512-byte frame format is shared.

## Open questions

These were asked and not yet answered; the plan above assumes the
recommendation and changes if the answers differ.

1. **What is the main goal?** A live mirror (option 1), previewing messages
   before they're sent (option 2), or designing the layouts themselves
   (option 3)?
2. **Are firmware changes acceptable, or server-only for now?** Option 1 and
   the hybrid need a firmware change; option 2 doesn't.

## Things to verify before building

- The BDF for `u8g2_font_6x10_tf` (and any later font) exists in U8g2's
  source, and its glyphs match the compiled font byte for byte.
- U8g2's text placement rule for a baseline y (it takes the glyph's own
  bounding-box offsets), by rendering a known string on the server and
  comparing with a photo or the mirror once a device exists.
- The confirmation wording's length limit against the 21-column grid, and
  what the firmware does with an over-long line (truncate, wrap, or clip).
