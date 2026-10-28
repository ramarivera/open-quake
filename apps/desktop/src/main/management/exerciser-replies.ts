/** Failure discriminants used by the exercised desktop IPC contracts. Never retain payloads. */
export function failureReason(reply: unknown): string | undefined {
	if (typeof reply !== "object" || reply === null) return;
	const tag =
		"_tag" in reply ? reply._tag : "type" in reply ? reply.type : undefined;
	if (
		!["rejected", "failure", "error", "invalid"].includes(String(tag)) &&
		!("ok" in reply && reply.ok === false) &&
		!("success" in reply && reply.success === false)
	)
		return;
	return "code" in reply && typeof reply.code === "string"
		? reply.code
		: "reason" in reply && typeof reply.reason === "string"
			? reply.reason
			: String(tag ?? "unsuccessful");
}

/** Operation names only; never retain IPC request values. */
export function operationName(input: unknown): string {
	return typeof input === "object" && input !== null
		? String("type" in input ? input.type : "_tag" in input ? input._tag : "")
		: "";
}
export function isPassiveOperation(operation: string): boolean {
	return ["read", "query", "snapshot", "status"].includes(operation);
}
