import { useCallback } from "react";
import { useAppLocale } from "../i18n";

// Keep existing lookup keys stable for translated catalogs.
const english: Readonly<Record<string, string>> = {
	"General Settings default": "General settings default",
	"Use Dekie Agent": "Use agent",
	"Voice Input": "Voice input",
	"Wake Chat Window": "Open chat window",
	"Custom Role": "Custom role",
	"Role Prompt": "Role prompt",
	"System Role": "System role",
	"Enable Thinking": "Enable thinking",
	"Web Search": "Web search",
	"Reply Quality": "Reply quality",
	"Chat Timeout(s)": "Chat timeout in seconds",
	"AI Model Provider": "AI model provider",
	"Configure Models": "Configure models",
	"Change the AI provider in General Settings":
		"Change the AI provider in General settings",
};

const german: Readonly<Record<string, string>> = {
	"Assistant personality": "Assistentenpersönlichkeit",
	Update: "Aktualisieren",
	"Prompt library": "Prompt-Bibliothek",
	Reset: "Zurücksetzen",
	"Assistant updated. New settings apply to the next turn.":
		"Assistent aktualisiert. Die neuen Einstellungen gelten ab der nächsten Nachricht.",
	"Assistant settings couldn't be loaded.":
		"Die Assistenteneinstellungen konnten nicht geladen werden.",
	"Assistant settings couldn't be saved.":
		"Die Assistenteneinstellungen konnten nicht gespeichert werden.",
	"After closing, only the chat function will be available, and device control will be disabled.":
		"Nach dem Deaktivieren ist nur der Chat verfügbar. Die Gerätesteuerung ist deaktiviert.",
	"Auto supports chat and allowed Home Assistant entities. Other device control routes are unavailable in this build.":
		"Auto unterstützt Chat und freigegebene Home-Assistant-Entitäten. Andere Gerätesteuerungen sind in dieser Version nicht verfügbar.",
	"This provider/model requires its own sampling values. Saved assistant slider values are retained; provider defaults apply.":
		"Dieser Anbieter oder dieses Modell benötigt eigene Samplingwerte. Die gespeicherten Reglerwerte bleiben erhalten. Es gelten die Anbietervorgaben.",

	"Use Dekie Agent": "Agent verwenden",
	"Web Search": "Websuche",
	Personality: "Persönlichkeit",
	"Reply Quality": "Antwortqualität",
	"Chat Timeout(s)": "Chat-Zeitlimit in Sekunden",
	"HomeAssistant Control": "Home Assistant steuern",
	"HA Configuration": "HA-Konfiguration",
	Fastidious: "Anspruchsvoll",
	Flexible: "Flexibel",
	Conservative: "Konservativ",
	Gibberish: "Kauderwelsch",

	"AI Model Provider": "KI-Modellanbieter",
	"Add credentials in Models before using this assistant.":
		"Füge unter Modelle Zugangsdaten hinzu, bevor du diesen Assistenten verwendest.",
	Assistant: "Assistent",
	"Assistant preview": "Assistentenvorschau",
	"Assistant settings": "Assistenteneinstellungen",
	"Assistant settings are outside the allowed bounds.":
		"Die Assistenteneinstellungen liegen außerhalb der zulässigen Grenzen.",
	"Cancel migration": "Migration abbrechen",
	"Change the AI provider in General Settings":
		"KI-Anbieter in den allgemeinen Einstellungen ändern",
	"Chat history count": "Anzahl der Chatverläufe",
	"Configure Models": "Modelle konfigurieren",
	"Configure assistant": "Assistent konfigurieren",
	"Custom Role": "Eigene Rolle",
	"Default (Agent)": "Standard des Agenten",
	"Direct provider": "Direkter Anbieter",
	"Enable Thinking": "Denken aktivieren",
	"Filter roles": "Rollen filtern",
	"General Settings default": "Standard aus den allgemeinen Einstellungen",
	"Loading saved providers…": "Gespeicherte Anbieter werden geladen…",
	Model: "Modell",
	"Model ID": "Modell-ID",
	Models: "Modelle",
	"Preserved assistant JSON": "Erhaltene Assistenten-JSON",
	"Preview migration": "Migration ansehen",
	"Role Prompt": "Rollenanweisung",
	"Saved providers are unavailable.":
		"Gespeicherte Anbieter sind nicht verfügbar.",
	"Saved providers couldn't be loaded.":
		"Gespeicherte Anbieter konnten nicht geladen werden.",
	"Select AI chat provider": "KI-Chat-Anbieter auswählen",
	"Select entities": "Entitäten auswählen",
	"Speech settings": "Spracheinstellungen",
	"System Role": "Systemrolle",
	"Thinking is unsupported by this provider/model.":
		"Dieser Anbieter oder dieses Modell unterstützt kein Denken.",
	"Use reviewed replacement": "Geprüften Ersatz verwenden",
	"Voice Input": "Spracheingabe",
	"Wake Chat Window": "Chatfenster öffnen",
	"Web Search is unsupported by this provider/model.":
		"Dieser Anbieter oder dieses Modell unterstützt keine Websuche.",
};

export function useAssistantText() {
	const { locale } = useAppLocale();
	return useCallback(
		(text: string) =>
			locale === "de"
				? (german[text] ?? english[text] ?? text)
				: (english[text] ?? text),
		[locale],
	);
}
