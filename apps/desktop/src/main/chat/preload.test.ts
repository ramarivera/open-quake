import { expect, it } from "vitest";
import { createDirectChatBridge } from "./preload";

it.each([
	{
		code: "CHAT.HISTORY.STORAGE_FAILED",
		expectedCode: "CHAT.HISTORY.STORAGE_FAILED",
		tag: "ChatRpcFailure",
		message: "The private chat history could not be saved",
	},
	{
		code: "AI.PROVIDER.AUTH_REQUIRED",
		expectedCode: "AI.PROVIDER.AUTH_REQUIRED",
		tag: "ChatRpcFailure",
		message: "Provider credentials are required",
	},
	{
		code: "PRIVATE.TOKEN",
		expectedCode: "CHAT.TRANSPORT.UNAVAILABLE",
		tag: "ChatTransportUnavailable",
		message: "Chat transport unavailable",
	},
])(
	"rejects with a plain canonical catalog projection for $code",
	async ({ code, expectedCode, tag, message }) => {
		let receive = (_event: unknown, _value: unknown) => {};
		const bridge = createDirectChatBridge(
			{
				invoke: async (_channel, input) => {
					const request = input as { _tag: string; id: string };
					if (request._tag === "Request")
						receive(
							{},
							{
								_tag: "Exit",
								requestId: request.id,
								exit: {
									_tag: "Failure",
									cause: {
										_tag: "Fail",
										error: {
											_tag: "ChatRpcFailure",
											code,
											message: "private provider token",
											diagnosticCause: { message: "private path" },
										},
									},
								},
							},
						);
				},
				on: (_channel, listener) => {
					receive = listener;
				},
				removeListener: () => {},
			},
			{ disconnectOnDispose: false },
		);
		try {
			const failure: unknown = await bridge
				.list()
				.catch((error: unknown) => error);
			expect(failure).toStrictEqual({ _tag: tag, code: expectedCode, message });
			expect(failure).not.toBeInstanceOf(Error);
			expect(Object.getPrototypeOf(failure)).toBe(Object.prototype);
		} finally {
			await bridge.dispose();
		}
	},
);

it("projects transport failures without private details", async () => {
	const bridge = createDirectChatBridge(
		{
			invoke: async () => {
				throw new Error("private transport token");
			},
			on: () => {},
			removeListener: () => {},
		},
		{ disconnectOnDispose: false },
	);
	try {
		expect(await bridge.list().catch((error: unknown) => error)).toStrictEqual({
			_tag: "ChatTransportUnavailable",
			code: "CHAT.TRANSPORT.UNAVAILABLE",
			message: "Chat transport unavailable",
		});
	} finally {
		await bridge.dispose();
	}
});
