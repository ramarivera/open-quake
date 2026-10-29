import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { IconLibrary } from "./IconLibrary";
import "./icon-library.css";

export function NativeIconPicker({
	token,
	locale,
	onSelect,
	onClose,
}: {
	token: string;
	locale: ProfileLocale;
	onSelect: (data: string, source?: string) => void;
	onClose: (reason?: string) => void;
}): null {
	const callbacks = useRef({ onSelect, onClose });
	callbacks.current = { onSelect, onClose };
	useEffect(() => {
		let live = true;
		const nonce = `${token}:${crypto.randomUUID()}`;
		void window.quakeKeyLibrary
			.request({ type: "open-icons", token: nonce, locale })
			.then((reply) => {
				if (!live) return;
				if (reply._tag === "success" && reply.icon)
					callbacks.current.onSelect(reply.icon, reply.iconSource);
				callbacks.current.onClose(
					reply._tag === "rejected" ? reply.reason : undefined,
				);
			})
			.catch(() => {
				if (live) callbacks.current.onClose("Could not open icon library.");
			});
		return () => {
			live = false;
			void window.quakeKeyLibrary.request({
				type: "cancel-icons",
				token: nonce,
			});
		};
	}, [token, locale]);
	return null;
}

export function IconPickerSurface(): React.JSX.Element {
	const params = new URLSearchParams(location.search);
	const token = params.get("token") ?? "";
	const decoded = Schema.decodeUnknownEither(ProfileLocale)(
		params.get("locale"),
	);
	const locale = decoded._tag === "Right" ? decoded.right : "en";
	const [status, setStatus] = useState("");
	const choose = async (data: string, source: string): Promise<void> => {
		const reply = await window.quakeKeyLibrary.request({
			type: "pick-icon",
			token,
			data,
			source,
		});
		if (reply._tag === "rejected") setStatus(reply.reason);
	};
	return (
		<main className="icon-picker-surface">
			<IconLibrary
				locale={locale}
				onSelect={(data, source) => choose(data, source)}
				onClose={() =>
					void window.quakeKeyLibrary.request({ type: "cancel-icons", token })
				}
			/>
			{status && <p role="alert">{status}</p>}
		</main>
	);
}
