import { useEffect, useState } from "react";
import type { ClockMediaView } from "../../../../../shared/clock-contracts";
import type { ThemeId } from "../../../../../shared/clock-style";
import { themeArtUrl } from "./art";
import { captureThemeThumbnail } from "./capture-thumbnail";

export function ThemeThumbnail({
	themeId,
	media,
}: {
	themeId: ThemeId;
	media: ClockMediaView | undefined;
}): React.JSX.Element {
	const [thumbnail, setThumbnail] = useState<{ url: string; jpeg: string }>();
	const url =
		media?.available && media.kind === "video" ? media.url : undefined;
	useEffect(() => {
		if (!url) return;
		const controller = new AbortController();
		void captureThemeThumbnail(url, controller.signal).then((jpeg) => {
			if (!controller.signal.aborted && jpeg) setThumbnail({ url, jpeg });
		});
		return () => controller.abort();
	}, [url]);
	if (media?.available && media.kind === "video")
		return thumbnail?.url === media.url ? (
			<img src={thumbnail.jpeg} alt="" />
		) : (
			<span className="clock-theme-video-placeholder">▶ {media.name}</span>
		);
	return (
		<img src={media?.available ? media.url : themeArtUrl(themeId)} alt="" />
	);
}
