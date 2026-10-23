# Spec Delta

## Purpose
Public surface of the protocol kernel and the device conductor wrapper that
every open-quake consumer uses to talk to a QUAKE device.

## ADDED Requirements

### Requirement: Protocol layer is pure
`packages/protocol` SHALL perform no I/O; its encode/decode functions SHALL
be deterministic functions of their inputs.

#### Scenario: Host command framing
- **WHEN** a host command with flag `f` and payload `p` is framed
- **THEN** the result is `[0xA3, len(p)+1, f, ...p, (f + sum(p)) % 0xFF]`

#### Scenario: Corrupt device report
- **WHEN** a device report's trailing checksum does not match
- **THEN** verification reports it invalid without throwing

### Requirement: Non-Effect consumers are supported
`packages/device` SHALL expose an entry point that a consumer can use without
importing or running Effect.

#### Scenario: Plain JS consumer
- **WHEN** a plain JavaScript program uses the device entry point
- **THEN** it can connect and receive device events without constructing an Effect runtime itself
