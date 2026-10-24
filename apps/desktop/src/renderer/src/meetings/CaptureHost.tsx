import { useEffect } from "react";
import { createMeetingCapture } from "./capture";
export function CaptureHost(): React.JSX.Element {
	useEffect(() => {
		const bridge = window.quakeMeetings;
		if (!bridge) return;
		const capture = createMeetingCapture(bridge);
		const off = bridge.onCapture((request) => {
			void capture.handle(request);
		});
		return () => {
			off();
			capture.dispose();
		};
	}, []);
	return <p role="status">Meeting audio capture</p>;
}
