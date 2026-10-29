import { useId } from "react";
import {
	ambientStyleLabels,
	ambientStyles,
	isAmbientStyle,
	useAmbientStyle,
} from "./ambient-appearance";

export function AmbientSettings({ serial }: { serial?: string | undefined }) {
	const { style, select, notice } = useAmbientStyle(serial);
	const id = useId();
	return (
		<section className="ambient-settings" aria-label="Ambient appearance">
			<label htmlFor={id}>Visual style</label>
			<select
				id={id}
				value={style}
				disabled={!serial}
				onChange={(event) => {
					if (isAmbientStyle(event.target.value)) select(event.target.value);
				}}
			>
				{ambientStyles.map((value) => (
					<option value={value} key={value}>
						{ambientStyleLabels[value]}
					</option>
				))}
			</select>
			<p>
				Styles apply immediately. Your original media and playlist stay
				available.
			</p>
			{style === "lava" || style === "ambilight" ? (
				<p>
					Reacts to your background video's audio. Add a music video below and
					enable background sound. Without audio, the background rests. It
					doesn't listen to other apps or your microphone. The Studio preview
					stays muted.
				</p>
			) : null}
			{notice ? <p role="status">{notice}</p> : null}
		</section>
	);
}
