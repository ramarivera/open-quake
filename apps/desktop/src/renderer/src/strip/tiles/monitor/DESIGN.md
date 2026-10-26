# Monitor design ownership

`MonitorPanel.tsx` and `monitor.css` are hand-authored Open Quake design inputs.
There is no canvas generator, computed-style dump, or bundled vendor monitor JPEG.
The checked-in CSS and JSX are the reproducible replacement for WIDGETS-074.

The five compatibility IDs retain module grouping and the 1920 by 480 logical
stage. Glass keeps compute, memory/process, storage/network and energy columns.
Cyber keeps a 40 px status ticker and six HUD columns. The remaining layouts keep
their compute, storage, process, network and power groups and disk touch target.

The independent-device-design palette governs every style. Opaque dark surfaces,
flat bars and system type replace glass, gradients, glow, scanlines, sparkle,
wobble, bounce and lamp decoration. This deliberately supersedes the vendor's
visuals and animation signatures for WIDGETS-068 through WIDGETS-074 and
WIDGETS-079. The old names are import identifiers, not material descriptions.
Built-in backgrounds are the flat canvas drawn by CSS. No absent asset is claimed.
Custom user imagery remains selectable underneath opaque metric cards and a scrim.

Behavioral references, read locally during this change, are DK-Suite 0.4.95
`shared/monitorStyleContract.js`, `SystemMonitorPanel.vue` and the five
`SystemMonitorPanel*Canvas.vue` files. They supply field identity, grouping,
background semantics and lifecycle requirements. No generated CSS is redistributed.
