import { isManagementExternalLink } from "../../shared/management-external";

/** Called only in the isolated preload. DOM isTrusted cannot be set by renderer JS. */
export function installManagementExternalLinks(
	document: Document,
	mainFrame: boolean,
	send: (url: string) => void,
): () => void {
	if (!mainFrame) return () => {};
	const click = (event: MouseEvent) => {
		const anchor = event
			.composedPath()
			.find(
				(node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement,
			);
		if (!anchor) return;
		event.preventDefault();
		if (
			event.isTrusted &&
			event.button === 0 &&
			isManagementExternalLink(anchor.href)
		)
			send(anchor.href);
	};
	document.addEventListener("click", click, true);
	return () => document.removeEventListener("click", click, true);
}
