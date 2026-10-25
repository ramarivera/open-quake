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

// Auxiliary capture and picker windows have separate IPC ownership. They do
// not ask the management/panel locale service for an unauthorized snapshot.
const surface = params.get("surface");
const auxiliary =
	surface !== null && surface !== "panel" && surface !== "management";
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<AppLocaleProvider bridge={auxiliary ? null : window.quakeLocale}>
			<App />
		</AppLocaleProvider>,
	);
}
