# Design

## Context

See proposal.md for scope. Copy lives in JSX literals, English/German feature dictionaries and eight-locale recovered dictionaries. Shared PageHeader, Group and Row components already omit absent description elements.

## Decisions

Remove filler at its call site and delete its key in every dictionary containing it. Shorten mixed lines while preserving instructions. Keep shared description/hint props because useful copy still uses them. Only render the login hint wrapper when OS status or a failure exists, so deleting filler does not leave a gap.

## Risks

Copy assertions can retain deleted keys. Update the clock locale assertion and run the desktop suite, including catalog-error-coverage, without launching Electron or hardware tests.
