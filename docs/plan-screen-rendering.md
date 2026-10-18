# Plan: a live mirror of the device's screen in the web UI

**Status**: decided 2026-09-29, **not implemented yet**. Rewritten 2026-10-18
for the screen the firmware has now (one big line, the clock first). The
device is built and running, so the bench step at the end is no longer
waiting on hardware.

## Why this exists

The screen is a 0.91" SSD1306 OLED: **128×32, 1-bit**, I2C, drawn with
U8g2's built-in bitmap fonts and a full frame buffer. Today it shows one big
line (`u8g2_font_helvB24_tf`): the clock, with temperature, humidity and
light on pages reached by pushing the stick left and right, and small
`6x10` marks in the corners (AM/PM, a problem flag). The whole frame also
drifts by one pixel every few minutes to spread burn-in (`display.cpp`).

The goal (the owner's, 2026-09-29): **see what's on the screen in the web UI,
live, even as icons and other things are added to it**. Firmware changes are
fine.

What can't be derived from the pixels is the panel's **level** (Off / Dim /
Full are power-save, contrast and voltage settings, not image content). It
already travels as `screen` in `bedside/sensors`, so the UI combines the
two, and fakes the look: scale up with nearest-neighbour, lit pixels in one
fixed colour.

## Decision: mirror the real framebuffer

The device publishes the 512-byte frame it just sent to the panel, when it
changes, rate-limited. The server keeps the latest and serves it; the Device
page draws it scaled up on a canvas.

- **Exact by definition**, including the burn-in drift, because it is the
  frame the panel got. Anything the firmware draws later (icons, new pages,
  a different layout) shows up with no server work.
- No font or layout duplication anywhere, so nothing to drift out of sync.
- A small firmware change plus one new topic and ACL lines for it.

Considered and not needed: rendering the same fonts on the server (Pillow;
the layout would exist twice and drift), and having the server draw the whole
frame and push it (the device still needs a local screen for a power cut and
for before Wi-Fi, and every change becomes a 512-byte message). The
on-screen confirmations the firmware's DESIGN.md lists as still to build
("Press again: Close garage") would be worded by the server for a 128×32 panel;
checking that a message fits is simplest as firmware truncation, so the
server needn't draw anything for that.

## Implementation plan

Everything except the firmware step can be built and tested with a synthetic
frame.

### Wire format

Topic **`bedside/screen`**, device → server, **retained**, QoS 0. Payload:
exactly **512 raw bytes**, the U8g2 buffer as sent to the panel (after the
burn-in drift). Layout (U8g2's native tile buffer for a 128×32 panel, four
8-pixel pages): byte `page * 128 + x` holds the pixels `(x, page*8 + 0..7)`,
**bit 0 = the top pixel** of the eight, a set bit = lit. A payload of any
other length is ignored (that doubles as the version check).

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
   `bedside-aggregator` read on `bedside/screen`. **The central broker
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
   black with "Screen off". No frame yet, or the device offline: "Waiting for
   the first frame" / the last frame dimmed with its age.
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
   `mosquitto_pub`, or a test fixture).
2. Firmware change, ACLs on both brokers, docs.
3. **Bench:** flash, compare the mirror with the panel (and a photo), and
   fix the layout if the bit order or orientation is off.

### Details to settle while building

- **Orientation.** `display.cpp` uses `U8G2_R0` and notes swapping to `U8G2_R2`
  if the panel ends up mounted upside down. With `R2` the buffer is in the
  panel's physical layout, so the mirror would look rotated compared with
  what you see. Either the firmware un-rotates the frame it publishes or the
  UI gets a "rotate 180°" choice; check which the box needs.
- **Traffic.** The clock shows hours and minutes, so a frame goes out about
  once a minute plus a burst when you push the stick, at 512 bytes each:
  negligible for the LAN broker. A clock with seconds would be the worst case.
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
