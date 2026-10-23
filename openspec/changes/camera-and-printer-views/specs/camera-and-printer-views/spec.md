# Spec Delta

## Purpose

Camera and printer status views share gateway state in recovered source. Their visible behavior can be designed now, while the unknown printer_3d_gateway protocol remains a separate implementation blocker.

## ADDED Requirements

### Requirement: Explicit feed configuration

The system SHALL accept configured camera/printer endpoints only through an adapter with a declared supported protocol, validate required fields and keep endpoint credentials out of display state and diagnostics.

#### Scenario: Unconfigured tile

- **WHEN** a camera or printer tile has no endpoint configuration
- **THEN** it shows unconfigured and starts no gateway or feed request

#### Scenario: Unsupported RTSP backend

- **WHEN** a user selects RTSP but no verified RTSP adapter exists
- **THEN** the tile reports unsupported and does not treat the URL as an image source

### Requirement: Camera feed state and bounds

Camera views SHALL expose starting, live, stopped and failed states, decode only supported frames, and keep at most one frame in flight with a maximum delivery rate of 10 fps. Old frames SHALL be dropped rather than queued.

#### Scenario: Slow panel consumer

- **WHEN** frames arrive faster than the panel can display them
- **THEN** only the newest pending frame is retained and memory does not grow with frame count

#### Scenario: Stream loss

- **WHEN** the source stops delivering valid frames for ten seconds
- **THEN** the view stops presenting the last frame as live and reports a stream failure

### Requirement: Normalized printer status

Printer status SHALL include an explicit state, timestamp and optional progress percent, current/total layers, bed/nozzle temperatures, remaining minutes and job name. Unsupported or absent fields SHALL be shown as unavailable; samples older than ten seconds SHALL be stale.

#### Scenario: Valid progress update

- **WHEN** a ready adapter reports RUNNING, 42 percent and no bed temperature
- **THEN** the view shows printing at 42 percent with unavailable bed temperature

#### Scenario: Gateway offline

- **WHEN** the gateway disconnects after a valid sample
- **THEN** the view reports offline/stale and does not reset last known progress to zero

### Requirement: Verified gateway capabilities

The system SHALL distinguish gateway stopped, starting, ready and failed states and SHALL gate production start/control on a verified adapter. Camera controls SHALL be disabled unless the active adapter advertises verified control support.

#### Scenario: Unverified gateway

- **WHEN** only the recovered opaque binary is available with no verified protocol contract
- **THEN** gateway launch remains unavailable and the reason identifies missing adapter verification

#### Scenario: Unsupported pan

- **WHEN** a cameraControlView requests pan on a read-only adapter
- **THEN** the action reports unsupported and no control message is sent

### Requirement: Feed teardown and recovery

Closing a view or switching profiles SHALL unsubscribe its feeds and release unshared stream resources. Reconnect SHALL refresh status before restoring live indicators.

#### Scenario: Switch profile

- **WHEN** the last camera view leaves the active profile
- **THEN** its stream request is cancelled and no frame continues to target the old view

#### Scenario: Gateway restarts

- **WHEN** a stopped gateway becomes ready again
- **THEN** the view reconnects only for active subscribers and marks live after a new valid frame/sample
