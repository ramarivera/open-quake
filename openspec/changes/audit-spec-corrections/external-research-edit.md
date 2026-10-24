# Exact external research edit

Do not edit the external repo from this lane. Target: `/Users/ramarivera/dev/dark-encyclopedia/REVERSE_ENGINEERING.md`, §9.12, currently line 1872. The file is absent from open-quake and its vendored skill. Evidence: `SETTINGS-047/048` and [Microsoft UF2 file format](https://github.com/microsoft/uf2#file-format), accessed 2026-10-24.

Replace the heading:

```markdown
### 9.12 UF2 Firmware Extraction — Watch for Signature Variants
```

with:

```markdown
### 9.12 UF2 firmware extraction with standard magic
```

Replace the first paragraph with:

```markdown
UF2 is the standard delivery format for Raspberry Pi RP2040/RP2350 firmware. The standard first magic is `0x0A324655`, stored little-endian as `55 46 32 0A` ("UF2\n"). It is not a nonstandard newline variant. `55 46 32 00` ("UF2\0") is not the standard magic. Every block also requires second magic `0x9E5D5157` and final magic `0x0AB16F30`. The recovered QUAKE images have RP2040 family ID `0x1aa143c7`, app start `0x00012000`, and a vendor bootloader volume named `QUAKE DFU` (SETTINGS-047/048). See https://github.com/microsoft/uf2#file-format, accessed 2026-10-24.
```

Replace the parser comment:

```python
# Python parser that tolerates both \0 and \n terminators
```

with:

```python
# Python parser that requires all three standard UF2 magic values
```

Replace this predicate:

```python
    if (magic1 & 0xFFFFFF) != 0x324655 or magic2 != 0x9E5D5157:
```

with:

```python
    magic_end = struct.unpack_from('<I', blk, 508)[0]
    if magic1 != 0x0A324655 or magic2 != 0x9E5D5157 or magic_end != 0x0AB16F30:
```

This corrects the extraction example's magic check only. The example remains an extraction tool, not a firmware-write validator: trusted board provenance, block consistency, payload bounds, flash-range validation and device identity are still required before any write.
