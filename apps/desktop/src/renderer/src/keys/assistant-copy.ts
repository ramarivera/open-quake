import { useCallback } from "react";
import { useAppLocale } from "../i18n";

const german: Readonly<Record<string, string>> = {
	"After closing, only the chat function will be available, and device control will be disabled.":
		"Nach dem Deaktivieren ist nur der Chat verfügbar. Die Gerätesteuerung ist deaktiviert.",
	"Auto supports chat and allowed Home Assistant entities. Other device control routes are unavailable in this build.":
		"Auto unterstützt Chat und freigegebene Home-Assistant-Entitäten. Andere Gerätesteuerungen sind in dieser Version nicht verfügbar.",
	"This provider/model requires its own sampling values. Saved assistant slider values are retained; provider defaults apply.":
		"Dieser Anbieter oder dieses Modell benötigt eigene Samplingwerte. Die gespeicherten Reglerwerte bleiben erhalten. Es gelten die Anbietervorgaben.",

	"Use Dekie Agent": "Dekie-Agent verwenden",
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
		(text: string) => (locale === "de" ? (german[text] ?? text) : text),
		[locale],
	);
}
