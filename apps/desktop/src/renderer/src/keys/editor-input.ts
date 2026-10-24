/** MGMT-249: editable descendants own Delete, including nested contenteditable. */
export function editableFocus(element: Element | null): boolean {
	return !!element?.closest(
		'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
	);
}
