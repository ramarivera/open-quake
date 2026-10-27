const messages: Readonly<
	Record<string, { readonly en: string; readonly de: string }>
> = {
	"QUAKE.MEETING.AUDIO_MISSING": {
		en: "Audio recording file is missing. Please record again.",
		de: "Die Audioaufnahme fehlt. Eine erneute Aufnahme ist erforderlich.",
	},
	"QUAKE.MEETING.AUDIO_EXPIRED": {
		en: "Audio file expired and was deleted. Please record again.",
		de: "Die Audiodatei ist abgelaufen und wurde gelöscht. Bitte erneut aufnehmen.",
	},
	"QUAKE.MEETING.TRANSCRIPT_MISSING": {
		en: "Transcription file is missing. Please retry transcription before regenerating.",
		de: "Das Transkript fehlt. Bitte zuerst die Transkription erneut starten.",
	},
	"QUAKE.MEETING.NO_VALID_SPEECH": {
		en: "No valid speech detected. Please check the audio source and record again.",
		de: "In der Aufnahme wurde keine Sprache erkannt. Bitte die Audioquelle prüfen und erneut aufnehmen.",
	},
};
export const meetingFailure = (
	code: string,
	fallback: string,
	locale: string,
): string => messages[code]?.[locale === "de" ? "de" : "en"] ?? fallback;
