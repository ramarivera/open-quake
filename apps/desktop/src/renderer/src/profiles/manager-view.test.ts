import { describe, expect, it, vi } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { installProfileCatalog } from "../../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import type {
	ProfileBridge,
	ProfileReply,
} from "../../../shared/profile-manager";
import { selectedManagerProfile, subscribeManagerView } from "./manager-view";

describe("manager view lifetime", () => {
	it("ignores obsolete success and failure replies while preserving current subscriptions", async () => {
		const replies: ((reply: ProfileReply) => void)[] = [];
		const offGuidance = vi.fn();
		const guidance = vi.fn();
		const offSnapshot = vi.fn(),
			offProgress = vi.fn();
		const bridge: ProfileBridge = {
			onForegroundGuidance: vi.fn(() => offGuidance),
			request: () => new Promise((resolve) => replies.push(resolve)),
			onSnapshot: vi.fn(() => offSnapshot),
			onProgress: vi.fn(() => offProgress),
			onSelection: () => () => {},
		};
		const view = vi.fn(),
			status = vi.fn(),
			progress = vi.fn();
		const offEnglish = subscribeManagerView(
			bridge,
			"en",
			view,
			progress,
			status,
			guidance,
		);
		offEnglish();
		const offGerman = subscribeManagerView(
			bridge,
			"de",
			view,
			progress,
			status,
			guidance,
		);
		replies[1]?.({ _tag: "rejected", reason: "current failure" });
		replies[0]?.({ _tag: "rejected", reason: "stale failure" });
		await Promise.resolve();
		expect(status).toHaveBeenCalledExactlyOnceWith("current failure");
		offGerman();
		const offFrench = subscribeManagerView(
			bridge,
			"fr",
			view,
			progress,
			status,
			guidance,
		);
		offFrench();
		replies[2]?.({
			_tag: "success",
			view: {
				envelope: encodeProfileEnvelope(createInitialProfileEnvelope()),
				serials: [],
				apps: [],
				thumbnails: {},
				progress: { running: false, done: 0, total: 0, failed: 0 },
			},
		});
		await Promise.resolve();
		expect(view).not.toHaveBeenCalled();
		expect(bridge.onSnapshot).toHaveBeenCalledWith(view);
		expect(bridge.onProgress).toHaveBeenCalledWith(progress);
		expect(offSnapshot).toHaveBeenCalledTimes(3);
		expect(offProgress).toHaveBeenCalledTimes(3);
		expect(offGuidance).toHaveBeenCalledTimes(3);
	});
	it("shows a visible profile when an old macOS preview selection points to hidden Discord", () => {
		const envelope = installProfileCatalog(
			createInitialProfileEnvelope(),
			"darwin",
		);
		const selected = selectedManagerProfile({
			...envelope,
			activeByDevice: { "desktop-preview": { profileId: "1-0", pageId: "1" } },
		});
		expect(selected?.id).toBe("1-1");
	});
});
