import { chatSmoke } from "./chat-smoke";
import { copilotSmoke } from "./copilot-smoke";
import { inputSmoke } from "./input-smoke";
import { knobConversationSmoke } from "./knob-conversation-smoke";
import { overlaySmoke } from "./overlay-smoke";
import { toolTouchSmoke } from "./tool-touch-smoke";
import { workspaceSmoke } from "./workspace-smoke";

const nativeRequire: NodeJS.Require = globalThis.require;
const { ipcRenderer }: typeof import("electron") = nativeRequire("electron");
let passed = 0;
async function run() {
	document.documentElement.dataset.motion = "full";
	for (const smoke of [
		chatSmoke,
		inputSmoke,
		copilotSmoke,
		overlaySmoke,
		workspaceSmoke,
		toolTouchSmoke,
		knobConversationSmoke,
	])
		passed += await smoke();
	ipcRenderer.send("conversation-smoke-result", { passed });
}
void run().catch((error: unknown) =>
	ipcRenderer.send("conversation-smoke-result", {
		passed,
		error: error instanceof Error ? error.stack : String(error),
	}),
);
