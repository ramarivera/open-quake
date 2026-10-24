# Device settings verification

The main device bus owns the session. `registerHardware` only exposes its
validated settings commands and subscribes to OS lock/unlock. The renderer
uses Firmware Version, Knob LED stays on, Device Alert Volume, Device Mic,
Device Luminance and Buzzer from DK-Suite locale-en.json. USB microphone
selection and firmware upgrading belong to other lanes.

Run the full media smoke documented in `../media/README.md` with
`OPEN_QUAKE_MOCK_DEVICE=1`. Hardware controls also have a hidden-window native
smoke that exercises the actual rendered controls and fake HID:

```sh
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/hardware/smoke.config.ts
OPEN_QUAKE_MOCK_DEVICE=1 env -u ELECTRON_RUN_AS_NODE pnpm --filter @open-quake/desktop exec electron out/hardware-smoke/smoke.js /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/hw-controls/native
```

The screenshot directory must be under the lane scratch root. The smoke's
user data and serial preferences are temporary children of that directory and
are removed on exit. It never uses the desktop entry point or native HID.
Dark/light, narrow and disconnected screenshots are saved there. The smoke
closes its window, unregisters handlers and disposes both runtimes before quit.
