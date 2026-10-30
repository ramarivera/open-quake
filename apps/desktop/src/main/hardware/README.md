# Device settings verification

The main device bus owns the session. `registerHardware` only exposes its
validated settings commands and subscribes to OS lock/unlock. The renderer
uses Firmware version, Knob LED stays on, Device alert volume, Device mic,
Device luminance and Buzzer from DK-Suite locale-en.json. USB microphone
selection and firmware upgrading belong to other lanes.

Run the full media smoke documented in `../media/README.md` with
`OPEN_QUAKE_MOCK_DEVICE=1`. Hardware controls also have a hidden-window native
smoke that exercises the actual rendered controls and fake HID:

```sh
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/hardware/smoke.config.ts
OPEN_QUAKE_MOCK_DEVICE=1 env -u ELECTRON_RUN_AS_NODE pnpm --filter @open-quake/desktop exec electron out/hardware-smoke/smoke.js /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/hardware/native
```

The screenshot directory must be under the lane scratch root. The smoke's
user data and serial preferences are temporary children of that directory and
are removed on exit. It never uses the desktop entry point or native HID.
Dark/light, narrow and disconnected screenshots are saved there. The smoke
closes its window, unregisters handlers and disposes both runtimes before quit.

Linux is the primary hardware target. The packaged resource
`resources/linux/70-open-quake.rules` grants the active local seat user access
to QUAKE hidraw nodes only. An administrator can review and copy it to
`/etc/udev/rules.d/70-open-quake.rules`, reload udev rules and reconnect QUAKE.
The application never installs rules or changes permissions itself. Discovery
also checks FF60:61 and requires an unambiguous nonblank canonical serial, so a
changed `/dev/hidrawN` path doesn't change saved identity. ARIS-68 is excluded.

Host shortcut mode needs existing write access to `/dev/uinput` on x64/arm64
Linux. The QUAKE rule deliberately grants no input/uinput access. Without that
permission, switching into host mode fails explicitly; switching back to device
mode remains available. Device mode requires no native host input permission.
