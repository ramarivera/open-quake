/** Original open-quake release-limit copy, approved by the device design owner. */
export const soundboardLabels = {
	source: "Local playlist",
	title: "Audio player is not configured properly",
	detail: "Select local MP3 files and valid playback settings to use this key.",
	compact: "Unavailable",
	accessibleName: "Local playlist, configuration required",
} as const;

/** DK-Suite locales: spotify.tabLocal, defaultAppMenu.playStop, clawDashboard.stop. */
export const localPlayerLabels = {
	en: {
		source: "Local music",
		toggle: "Play/stop",
		stop: "Stop",
	},
	de: {
		source: "Lokale Musik",
		toggle: "Wiedergabe/Stopp",
		stop: "Stopp",
	},
	zh: {
		source: "本地音乐",
		toggle: "播放/停止",
		stop: "停止",
	},
	fr: {
		source: "Musique locale",
		toggle: "Lecture/Arrêt",
		stop: "Arrêter",
	},
	es: {
		source: "Música local",
		toggle: "Reproducir/Detener",
		stop: "Detener",
	},
	it: {
		source: "Musica locale",
		toggle: "Riproduci/Stop",
		stop: "Ferma",
	},
	ja: {
		source: "ローカル音楽",
		toggle: "再生/停止",
		stop: "停止",
	},
	ko: {
		source: "로컬 음악",
		toggle: "재생/중지",
		stop: "중지",
	},
} as const;
