## ADDED Requirements

### Requirement: Explicit bounded real-device automation

The acceptance suite SHALL require explicit native opt-in, an exact stable device identity and a single owner before opening hardware. Default tests SHALL use only fake transports.

#### Scenario: Native mode is not opted in

- **WHEN** ordinary tests run without native authorization variables
- **THEN** no native discovery or device open occurs and no fake result counts as physical acceptance

### Requirement: Reversible state changes

The suite SHALL capture original queryable settings before separately authorized mutations and SHALL attempt and verify restoration on success or failure. Product preferences SHALL remain untouched.

#### Scenario: Mutation fails after writing

- **WHEN** a reversible mutation or assertion fails
- **THEN** registered cleanup attempts every original state restoration and reports restoration failures without hiding the original failure

### Requirement: Honest scenario coverage

The suite SHALL emit a fixed named inventory with pass, fail, skip and physical-only outcomes. Native coverage SHALL count native passes against the entire inventory and SHALL identify the tested source revision.

#### Scenario: Run completes without physical gestures

- **WHEN** automated checks complete
- **THEN** touch, knob gestures, physical hot-plug, visual placement and human audio/input acceptance remain explicitly unverified rather than disappearing from the denominator

### Requirement: Narrow hardware-qualified V3 control

For exact QUAKE:3:1.0.19 firmware and protocol 12, production lighting SHALL expose only readable and writable effect speed through shared-owner channel 3/value 3. Brightness, color, effect selection and flash save SHALL remain unavailable. Other identities SHALL not inherit this qualification.

#### Scenario: Installed qualified V3 device is selected

- **WHEN** the lighting consumer selects the exact qualified identity
- **THEN** it reads and applies speed with actual readback through the existing shared owner, and unsupported changes and save perform no IO
