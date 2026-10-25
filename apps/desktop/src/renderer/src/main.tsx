import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppLocaleProvider } from "./i18n";
import "./panelRotation.css";

const params = new URLSearchParams(window.location.search);
if (params.get("surface") === "panel") {
	document.documentElement.dataset.surface = "panel";
	if (params.get("rotation") === "90")
		document.documentElement.dataset.rotation = "90";
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<AppLocaleProvider>
			<App />
		</AppLocaleProvider>,
	);
}
