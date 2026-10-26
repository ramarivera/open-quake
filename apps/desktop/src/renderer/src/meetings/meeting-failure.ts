const messages: Readonly<
	Record<string, { readonly en: string; readonly de: string }>
> = {
	"QUAKE.MEETING.AUDIO_MISSING": {
		en: "Audio recording file missing, cannot retry.",
		de: "Die Audioaufnahme fehlt. Eine erneute Aufnahme ist erforderlich.",
	},
	"QUAKE.MEETING.AUDIO_EXPIRED": {
		en: "Audio file expired and deleted.",
		de: "Die Audiodatei ist abgelaufen und wurde gelöscht. Bitte erneut aufnehmen.",
	},
	"QUAKE.MEETING.TRANSCRIPT_MISSING": {
		en: "Transcription file missing, cannot regenerate",
		de: "Das Transkript fehlt. Bitte zuerst die Transkription erneut starten.",
	},
	"QUAKE.MEETING.NO_VALID_SPEECH": {
		en: "No valid speech detected in the recording.",
		de: "In der Aufnahme wurde keine Sprache erkannt. Bitte die Audioquelle prüfen und erneut aufnehmen.",
	},
};
export const meetingFailure = (
	code: string,
	fallback: string,
	locale: string,
): string => messages[code]?.[locale === "de" ? "de" : "en"] ?? fallback;
