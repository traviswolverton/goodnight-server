# Plan: pixel-exact rendering of the device's screen on the server

**Status**: **decided 2026-09-29: option 1, mirror the real framebuffer**
(see "Decision"). NOT implemented yet. Written up after a planning
discussion; the owner's answers are recorded below.

Nothing here has been run, and it predates the device being built (the
device now runs, and its screen is one big line rather than the 6×10 text
below): every claim about the panel is from the firmware
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

## Decision

The owner's answers (2026-09-29): the goal is a **live mirror** of the screen,
*even as icons and other things are added to it*; **firmware changes are
fine**.

That settles it: **option 1**. Because the mirror is the frame the panel
actually got, anything the firmware draws later (icons, a clock, new
layouts) shows up in the web UI with no server work, which no option that
re-implements the drawing (2, or the layout half of 3) can promise.

- Option 2 is **not needed** for the mirror. It stays on the shelf for one
  narrower job, checking that a worded confirmation fits 21×3 characters
  before it's sent; only worth building if that check turns out to matter
  (the firmware truncating a long line is a simpler answer).
- Option 3 is **not needed**: the device keeps drawing its own screens.

## Implementation plan

Order matters: everything except the last step can be built and tested with
no hardware, using a synthetic frame.

### Wire format

Topic **`bedside/screen`**, device → server, **retained**, QoS 0. Payload:
exactly **512 raw bytes**, the U8g2 buffer as sent to the panel (after the
burn-in drift). Layout (U8g2's native tile buffer for a 128×32 panel, four
8-pixel pages): byte `page * 128 + x` holds the pixels `(x, page*8 + 0..7)`,
**bit 0 = the top pixel** of the eight, a set bit = lit. A payload of any
other length is ignored (that doubles as the version check).

The panel's level (Off / Dim / Full) is not in the frame; it already
travels as `screen` in `bedside/sensors`, and the UI combines the two.

### Server (this repo)

1. `app/settings.py`: `mqtt_screen_topic = "bedside/screen"`.
2. `app/device.py`: subscribe to it with the other device topics;
   `DeviceState` keeps the latest frame and when it arrived; `handle()`
   stores a 512-byte payload and ignores anything else.
3. `app/api/device.py`: `GET /api/device/screen` (any signed-in role, like
   the rest of the Device page) returning
   `{width: 128, height: 32, frame: <base64> | null, age_seconds: <n> | null}`.
   Separate from `GET /api/device` so the page can poll just this, every
   second, without dragging the presses and config along.
4. Tests: a valid frame is stored, a wrong length is ignored, the endpoint
   returns it and its age, and returns nulls before any frame.
5. Docs: DESIGN.md's topic table gets the row; `docs/mqtt-broker.md` and
   `mosquitto/config/acl.conf` give `bedside-esp32` write and
   `bedside-aggregator` read on `bedside/screen`. **The shared central broker
   (192.0.2.25) needs the same two ACL lines added by hand**; this repo's
   bundled broker is the opt-in local one.

### Web UI

1. `lib/screen.ts`: a pure `frameToPixels(bytes)` (the layout above), with
   unit tests including the bit order, and a `screenQuery` polling every
   second while the Device page is visible.
2. A **Screen** card at the top of the Device page: the frame on a canvas
   scaled with `image-rendering: pixelated` to the card's width (4:1), black
   background, lit pixels in a fixed panel colour. An optional pixel grid,
   remembered per browser like the Appearance choices.
3. The level: **Full** as is; **Dim** at reduced brightness; **Off** nearly
   black with "Screen off (dark room)". No frame yet, or the device offline:
   "Waiting for the first frame" / the last frame dimmed with its age.
4. The Device guide on the About page gets the screen in its picture.

### Firmware (bedside-dashboard-esp32)

1. After a frame is sent to the panel, note that the buffer may have
   changed. A small module publishes `bedside/screen` (retained, 512 bytes
   from `u8g2.getBufferPtr()`) when the buffer differs from the last one
   published (a CRC or `memcmp`), at most **once a second**, only while MQTT
   is up, and not while the panel is Off (nothing is lit; the retained frame
   plus the level says so). The existing 4096-byte MQTT buffer is plenty.
2. Add the topic to DESIGN.md's MQTT table, and a serial command or boot
   option that prints the frame as ASCII art: a bench check that the bit
   layout above matches what's really on the panel.

### Rollout

1. Server, UI and tests with a synthetic frame (a known bitmap published with
   `mosquitto_pub`, or a test fixture). Nothing needs the device.
2. Firmware change, ACLs on both brokers, docs.
3. **Bench, once the device is built:** flash, compare the mirror with the
   panel (and a photo), and fix the layout if the bit order or orientation
   is off.

### Details to settle while building

- **Orientation.** If the panel ends up mounted upside down and the firmware
  compensates with `U8G2_R2`, the buffer is in the panel's physical layout,
  so the mirror would look rotated compared with what you see. Either the
  firmware un-rotates the frame it publishes or the UI gets a "rotate 180°"
  choice; decide when the mounting is known.
- **Traffic.** At most 512 bytes a second, and only when the screen changes:
  negligible for the LAN broker. A clock with seconds is the worst case.
- **Retained message churn.** Every publish rewrites the broker's retained
  copy; fine at this rate, but worth a second look if it ever drives disk
  writes on the broker.
- **A PNG endpoint** (for a Home Assistant image entity or a notification)
  would need Pillow, which isn't a dependency today. Not in scope; the
  browser draws the canvas itself.

## Things to verify before building

- The buffer layout in "Wire format": that `u8g2.getBufferPtr()` for the
  128×32 full-buffer driver is 512 bytes in that page/bit order, and that
  `sendBuffer()` sends it unchanged (no rotation or post-processing between
  the buffer and the panel). The firmware's ASCII dump exists to check this
  on the bench.
- That a 512-byte retained binary `publish` works through PubSubClient with
  the existing 4096-byte buffer, and that the broker's ACL lets the device
  write the new topic (the ACL silently drops a forbidden write, so it looks
  like nothing arrived).
- What the firmware does today with a line longer than 21 columns, if the
  fit check (option 2, on the shelf) is ever wanted.
