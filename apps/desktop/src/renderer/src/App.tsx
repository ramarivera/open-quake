import { useEffect, useState } from "react"
import { useQuakeEvents } from "./useQuakeEvents"

function useSurface(): "management" | "panel" {
	const [surface, setSurface] = useState<"management" | "panel">("management")
	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		setSurface(params.get("surface") === "panel" ? "panel" : "management")
	}, [])
	return surface
}

function PanelSurface(): React.JSX.Element {
	const { rotations, presses, lastKeepAliveSeq, touchPoints } = useQuakeEvents()
	const alive = lastKeepAliveSeq !== null
	return (
		<div
			style={{
				width: "100vw",
				height: "100vh",
				display: "flex",
				alignItems: "center",
				gap: 32,
				padding: "0 48px",
				background: "#0b0e14",
				color: "#e6edf3",
			}}
		>
			<Stat label="ROTATIONS" value={rotations} />
			<Stat label="PRESSES" value={presses} />
			<Stat
				label="KEEP-ALIVE"
				value={alive ? `#${lastKeepAliveSeq}` : "waiting"}
				accent={alive ? "#3fb950" : "#d29922"}
			/>
			<Stat label="TOUCH" value={touchPoints.length ? `${touchPoints.length} pt` : "—"} />
			<span style={{ marginLeft: "auto", opacity: 0.5, fontSize: 12 }}>
				mock device source
			</span>
		</div>
	)
}

function Stat({
	label,
	value,
	accent,
}: {
	label: string
	value: string | number
	accent?: string
}) {
	return (
		<div>
			<div style={{ fontSize: 13, letterSpacing: 2, opacity: 0.6 }}>{label}</div>
			<div style={{ fontSize: 42, fontWeight: 700, color: accent }}>{value}</div>
		</div>
	)
}

function ManagementSurface(): React.JSX.Element {
	const { events, rotations, presses, lastKeepAliveSeq } = useQuakeEvents()
	return (
		<div style={{ fontFamily: "system-ui", padding: 24 }}>
			<h1>open-quake — management</h1>
			<p>Prototype: panel window + mock device bus are live.</p>
			<ul>
				<li>events received: {events.length}</li>
				<li>rotations: {rotations}</li>
				<li>presses: {presses}</li>
				<li>keep-alive seq: {lastKeepAliveSeq ?? "—"}</li>
			</ul>
			<p style={{ color: "#666" }}>
				The panel window owns the DK-QUAKE display (or a fallback window when
				the panel is unplugged).
			</p>
		</div>
	)
}

export function App(): React.JSX.Element {
	const surface = useSurface()
	return surface === "panel" ? <PanelSurface /> : <ManagementSurface />
}
