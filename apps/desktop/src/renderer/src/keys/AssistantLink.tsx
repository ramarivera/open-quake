import type { ReactNode } from "react";

/** Navigate within the owned document so host write authorization remains intact. */
export function AssistantLink({
	page,
	children,
}: {
	readonly page: string;
	readonly children: ReactNode;
}) {
	return (
		<a
			href={`?activeTab=${page}`}
			onClick={(event) => {
				event.preventDefault();
				window.dispatchEvent(
					new CustomEvent("open-quake:navigate", { detail: page }),
				);
			}}
		>
			{children}
		</a>
	);
}
