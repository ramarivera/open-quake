# Knob model

`KnobModel` owns firmware gesture arbitration, profile selectors, tile focus and
player volume. Its public commands and snapshots are Schema contracts. Call
`configure` with a committed device/profile/page context before dispatching.
A new session invalidates old commands and cancels timers and owned voice work.

Physical input uses firmware classifications, not host gesture thresholds:
rotation value 1 increases; press 1 interrupts voice, 2 selects Colorful Screen,
5 starts a correlated hold, and 255 releases that hold. The thumbnail picker
consumes short press. Double and hold dismiss its selection first, then continue
to Colorful Screen or push-to-talk, matching SCREEN-082/092. The voice port maps
to `knob-push-to-talk`; this module does not capture audio or implement an answer
turn. The generation remains owned after release so replacement or disposal can
cancel a responding voice turn.

Rotation priority is supported visible tile, armed available player volume,
ready thumbnail picker, then FunctionWheel. Stored left/right/center slots do
not execute on physical idle rotation. The legacy KnobService retains saved
configuration compatibility and focused-command validation.

The ring commits after 200 ms and hides at 3000 ms. Picker commits after 5000 ms
from the last detent or page arrow. Its ring feedback hides after 1200 ms.
Effect Clock owns every deadline. React cannot delay a commit. Cache warming
never replays a detent or replaces an open picker's entries.

`KnobModelPorts` is the composition contract:

- `selectProfile` persists a committed selection and returns its new context.
- `focusedTurn` resolves the pinned key against that context and executes one
  direction. Hotkey consumers map decrease/increase to action 0/1.
- `voice` receives action, device/profile session and hold generation.
- `readVolume` and `writeVolume` use integer percentages. Desired state advances
  for every detent, while a scoped writer drains the latest desired value after
  slow IO. Profile replacement interrupts pending writes. Observations cannot
  overwrite a detent for 500 ms; a 5 s stale probe checks driver availability.
- `warmThumbnails` returns local, decoded thumbnail data in menu order. Missing
  images keep the ring available. Reconfiguration invalidates stale warm jobs.

Tests in `test/knob/knob-model.test.ts` drive these ports, use TestClock for
commit/guard deadlines, hold a writer and cache job open to test concurrency,
and check wrapping and volume bounds with generated inputs.
