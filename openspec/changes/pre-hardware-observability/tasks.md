## Implementation

- [x] 1.1 Repair hardware/input boundary spans and safe failure coverage using identical Sol/Terra candidates.
- [ ] 1.2 Repair logger delivery/correlation/lifecycle using identical candidates; add Pino only after dependency approval.
- [ ] 1.3 Obtain independent Opus and Meta Wonder Full judgments, integrate justified changes and record comparison limits.
- [ ] 1.4 Inspect real retained failure/deferred-operation records, test privacy/fallback/shutdown, update retrieval docs and ship.

Execution epic `open-quake-fmx`; hosted signing rehearsal is separate in `open-quake-i3j.7`.

Hardware integration: both judges selected Sol 6314aad2, with parent repairs for interruption, duplicate events and optional span lookup. The focused desktop consumers pass 86 tests, device runtime/hardware consumers pass 151 tests, and both owning typechecks pass. Existing key-library strict-validation warnings remain baseline limitations.
