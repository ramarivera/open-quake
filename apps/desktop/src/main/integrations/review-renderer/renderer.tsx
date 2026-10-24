import { createRoot } from "react-dom/client";
import { AgentsPage } from "../../../renderer/src/management/agents/AgentsPage";
import { ChannelsPage } from "../../../renderer/src/management/integrations/ChannelsPage";
import { HomeAssistantPage } from "../../../renderer/src/management/integrations/HomeAssistantPage";
import { ShortcutsPage } from "../../../renderer/src/management/integrations/ShortcutsPage";

const root = document.getElementById("root");
if (!root) throw new Error("Missing review root");
const react = createRoot(root);
for (const button of document.querySelectorAll<HTMLButtonElement>(
	"[data-page]",
))
	button.onclick = () => {
		const page = button.dataset.page;
		react.render(
			page === "ha" ? (
				<HomeAssistantPage />
			) : page === "shortcuts" ? (
				<ShortcutsPage />
			) : page === "agents" ? (
				<AgentsPage initialTab="agents" />
			) : (
				<ChannelsPage />
			),
		);
	};
react.render(<ChannelsPage />);
