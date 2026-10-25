# MediaRemote adapter provenance

BSD-3-Clause source from https://github.com/ungive/mediaremote-adapter at
0e82bf1c44ec39554fbfc402ec88a48c6ae2a0fd, retrieved 2026-10-25.
No upstream binaries are redistributed. LICENSE accompanies packaged resources.

Local changes reject missing required symbols, expose enabled transport commands,
fail distinctly on read timeout, and require the expected source before commands.
Command capability signatures were checked against WebKit MediaRemoteSPI.h and
andrewwiik/iOS-Blocks Widgets/Music/MediaRemote.h. Native MediaRemote remains a
private macOS API and can become unavailable after an OS update.

The fixed Perl entry point loads this compiled framework, as described upstream.
It has no network, elevation, package installation or global-input behavior.
Only get and bounded send commands are invoked by open-quake. Upstream stream,
seek, repeat, shuffle and test routines remain in the source for provenance.
