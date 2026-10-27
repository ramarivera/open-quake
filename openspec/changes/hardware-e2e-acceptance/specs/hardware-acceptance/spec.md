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
