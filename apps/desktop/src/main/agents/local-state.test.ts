import { posix, win32 } from "node:path";
import { expect, it } from "vitest";
import { AgentInvalid } from "../../../../../packages/edge/src/agents/agents-errors";
import { validateLocalAgentDirectory } from "./local-state";

it.each([
	{
		platform: "Windows",
		paths: win32,
		root: "C:\\private\\runtime",
		outside: "D:\\private\\runtime\\data\\work",
	},
	{
		platform: "POSIX",
		paths: posix,
		root: "/private/runtime",
		outside: "/outside/work",
	},
])(
	"CENTER-047/048 validates private data directories on $platform",
	({ paths, root, outside }) => {
		for (const valid of [
			root,
			paths.join(root, "data", "work"),
			paths.join(root, "data", "work-2_3"),
		])
			expect(() =>
				validateLocalAgentDirectory(root, valid, paths),
			).not.toThrow();
		for (const invalid of [
			paths.join(root, "data"),
			paths.join(root, "data", "..", "escape"),
			paths.join(root, "data-other", "work"),
			paths.join(root, "data", "work", "nested"),
			paths.join(root, "data", ".hidden"),
			paths.join(root, "data", "x".repeat(65)),
			outside,
		])
			expect(() => validateLocalAgentDirectory(root, invalid, paths)).toThrow(
				AgentInvalid,
			);
	},
);
