# Spec Delta

## Purpose

DK-Suite exposes CPU, GPU, memory, disk, network, process, Bluetooth, and power tiles alongside app monitoring and gaming mode. A replacement needs explicit availability and sampling behavior before native collectors are chosen.

## ADDED Requirements

### Requirement: Metric identity and availability

The system SHALL expose CPU, GPU, memory, disk, network, process, Bluetooth and power metrics as timestamped samples with metric ID, value/unit when available, and one of available, unsupported, permission-denied, error or stale. Missing values SHALL NOT be displayed as zero.

#### Scenario: Unsupported collector

- **WHEN** a host has no supported GPU collector
- **THEN** the GPU tile reports unsupported and other supported tiles continue updating

#### Scenario: Sample becomes stale

- **WHEN** no new valid sample arrives within three configured sampling intervals
- **THEN** the tile retains the last value with its timestamp and labels it stale

### Requirement: Bounded sampling configuration

The system SHALL persist a monitoring master switch, enabled metric IDs, collection method and rate. It SHALL accept rates from 0.2 to 10 Hz, default to 1 Hz, and prevent overlapping collection for the same metric.

#### Scenario: Reject invalid rate

- **WHEN** a user saves 0 Hz or 11 Hz
- **THEN** the save fails with a field error and the last valid configuration remains active

#### Scenario: Slow collector

- **WHEN** a collection exceeds one interval
- **THEN** the system skips overlapping ticks rather than accumulating concurrent requests

### Requirement: App and window monitoring

The system SHALL publish foreground-window changes by window identity and owning application, coalesce concurrent queries, and stop collecting when app monitoring is disabled. Permission denial SHALL leave metric monitoring usable.

#### Scenario: Concurrent foreground requests

- **WHEN** two consumers request the foreground window while the first query is pending
- **THEN** both receive the same query result and only one host query runs

#### Scenario: Disable monitoring

- **WHEN** the user disables app monitoring while a poll is pending
- **THEN** no further poll is scheduled and the pending result does not reactivate monitoring

### Requirement: Reversible gaming mode

The system SHALL apply the saved gaming monitoring configuration while gaming mode is enabled and restore the latest saved normal configuration when it is disabled.

#### Scenario: Enter and leave gaming mode

- **WHEN** a user enables gaming mode with CPU-only tiles and then disables it
- **THEN** CPU-only monitoring runs during gaming mode and the saved normal tile selection returns afterwards

#### Scenario: Edit normal settings during gaming

- **WHEN** the user changes the saved normal rate while gaming mode is active
- **THEN** gaming sampling stays unchanged until exit, then the new normal rate applies

### Requirement: Shared monitor state

The system SHALL deliver the same normalized monitoring state to management and panel consumers and release collectors when monitoring stops or the application exits.

#### Scenario: One failing tile

- **WHEN** a network collector fails while CPU collection succeeds
- **THEN** both consumers show the same network error state and current CPU value

#### Scenario: Application shutdown

- **WHEN** the application exits during collection
- **THEN** collector timers and subscriptions are released and no native polling process remains owned by the session
