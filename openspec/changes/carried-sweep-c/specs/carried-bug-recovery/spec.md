## ADDED Requirements
### Requirement: Weather reports configuration and failure states
An enabled Clock weather tile SHALL show localized configuration guidance when no city or automatic lookup is selected, SHALL show an unavailable state after a failed fetch, and SHALL recover when settings become usable.
#### Scenario: Missing location followed by configuration
- **WHEN** an enabled tile has no configured location and the user then sets a valid city
- **THEN** the tile shows configuration guidance before fetching and renders weather after the request succeeds
#### Scenario: Forecast fails
- **WHEN** a configured tile cannot fetch weather
- **THEN** it shows localized weather unavailable text rather than indefinite loading

### Requirement: Local agent configuration requires an executable
The local agent adapter SHALL require an absolute path to an existing executable file before reporting a configured runtime.
#### Scenario: Invalid command path
- **WHEN** the command is missing, relative, a directory or not executable
- **THEN** the app uses its existing not-configured guidance

### Requirement: Monitor fallback labels match the displayed hardware
The anime monitor SHALL use a hardware label for a CPU model fallback and a graphics label only when a GPU model is available.
#### Scenario: Intel Mac without a GPU model
- **WHEN** only a CPU model is present
- **THEN** the displayed model is labeled as hardware rather than a graphics unit

### Requirement: Vendor takeover cancels DOM gestures
Vendor takeover SHALL cancel an active DOM gesture without confirming a tap and SHALL process the subsequent vendor gesture once.
#### Scenario: Vendor report resumes during a stationary DOM contact
- **WHEN** a vendor status or touch report takes ownership during an active DOM contact
- **THEN** the DOM contact ends without a confirmed tap and the vendor contact can activate once

### Requirement: Windows package installation recovers within bounds
The package smoke SHALL wait within a fixed deadline for relevant prior installer processes and retry failed silent installs within a fixed attempt limit with diagnostics. Exhausted attempts SHALL fail the smoke.
#### Scenario: Prior uninstaller and transient installer failure
- **WHEN** a prior package uninstaller remains active and the first install fails
- **THEN** the smoke waits for process completion and retries with an extended command timeout
#### Scenario: Persistent install failure
- **WHEN** every permitted install attempt fails
- **THEN** the smoke reports diagnostics and fails without running the packaged app
