import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	ManagedRuntime,
	Option,
	Tracer,
} from "effect";
import { describe, expect, it } from "vitest";
import { GeneralSettingsService } from "./general-service.js";
import type { SettingsDocument } from "./settings-contracts.js";
import {
	SettingsOsApplyFailed,
	SettingsPersistFailed,
	SettingsReadFailed,
	WizardIncomplete,
} from "./settings-errors.js";
import { SettingsOsPort, WizardOwners } from "./settings-ports.js";
import { SettingsStorage } from "./settings-repository.js";
import { SettingsService } from "./settings-service.js";
import { WizardService } from "./wizard-service.js";

const legacy = { version: 1, locale: "en", revision: 4 };
const draft = {
	step: "profiles",
	locale: "de",
	region: "DE",
	display: { _tag: "desktop-preview" },
	profileIds: ["local", "local"],
};
function fixture(initial: unknown = legacy) {
	let disk = structuredClone(initial),
		writes = 0,
		failWrite = false,
		failRead = false,
		denyLogin = false,
		login = false,
		reachable = false,
		usable = true,
		displayAvailable = false,
		supported = false,
		configured = false,
		seedCalls = 0;
	let writeGate: Effect.Effect<void> = Effect.void;
	let ownerGate: Effect.Effect<void, WizardIncomplete> = Effect.void;
	const loginWrites: boolean[] = [];
	const cause = Object.assign(new Error("token=private-do-not-serialize"), {
		code: "EACCES",
	});
	const infrastructure = Layer.mergeAll(
		Layer.succeed(SettingsStorage, {
			osLocale: "fr-FR",
			read: Effect.suspend(() =>
				failRead
					? Effect.fail(new SettingsReadFailed(cause))
					: Effect.succeed(Option.fromNullable(disk)),
			),
			write: (next: SettingsDocument) =>
				Effect.gen(function* () {
					yield* writeGate;
					if (failWrite) return yield* new SettingsPersistFailed(cause);
					disk = structuredClone(next);
					writes++;
				}),
		}),
		Layer.succeed(SettingsOsPort, {
			login: () => Effect.sync(() => login),
			setLogin: (enabled) =>
				Effect.suspend(() => {
					loginWrites.push(enabled);
					if (denyLogin) return Effect.fail(new SettingsOsApplyFailed(cause));
					login = enabled;
					return Effect.void;
				}),
			managementReachable: () => Effect.sync(() => reachable),
			workAreas: () =>
				Effect.succeed([{ x: -1920, y: 0, width: 1920, height: 1080 }]),
		}),
		Layer.succeed(WizardOwners, {
			displayAvailable: () => Effect.sync(() => displayAvailable),
			usableProfiles: () => ownerGate.pipe(Effect.as(usable)),
			runtimeSupported: Effect.sync(() => supported),
			runtimeConfigured: Effect.sync(() => configured),
			regionSuggestions: (region) =>
				Effect.sync(() => {
					seedCalls++;
					return { provider: `provider-${region}` };
				}),
		}),
	);
	const create = () =>
		ManagedRuntime.make(
			Layer.mergeAll(
				GeneralSettingsService.Default,
				WizardService.Default,
				SettingsService.Default,
			).pipe(Layer.provide(infrastructure)),
		);
	return {
		create,
		disk: () => structuredClone(disk),
		writes: () => writes,
		loginWrites,
		cause,
		seeds: () => seedCalls,
		failWrite: () => {
			failWrite = true;
		},
		failRead: () => {
			failRead = true;
		},
		denyLogin: () => {
			denyLogin = true;
		},
		reachable: () => {
			reachable = true;
		},
		unavailable: () => {
			usable = false;
		},
		deviceAvailable: () => {
			displayAvailable = true;
		},
		runtime: (ready: boolean) => {
			supported = true;
			configured = ready;
		},
		gateWrite: (gate: Effect.Effect<void>) => {
			writeGate = gate;
		},
		gateOwner: (gate: Effect.Effect<void, WizardIncomplete>) => {
			ownerGate = gate;
		},
	};
}
const snapshot = WizardService.snapshot();
describe("general preferences and resumable onboarding consumers", () => {
	it("bootstraps locale-only v1 documents once and shares locale/general/wizard commits", async () => {
		const f = fixture(),
			runtime = f.create();
		try {
			expect(await runtime.runPromise(snapshot)).toMatchObject({
				step: "welcome",
				completed: false,
				locale: "en",
			});
			expect(f.writes()).toBe(1);
			await Promise.all([
				runtime.runPromise(SettingsService.use((s) => s.setLocale("de"))),
				runtime.runPromise(GeneralSettingsService.save({ startHidden: true })),
				runtime.runPromise(
					WizardService.save({ step: "display", region: "DE" }),
				),
			]);
			expect(f.disk()).toMatchObject({
				locale: "de",
				revision: 7,
				general: { startHidden: true },
				wizard: { step: "display", region: "DE", completed: false },
			});
		} finally {
			await runtime.dispose();
		}
	});
	it("resumes after closing; completion is atomic, idempotent and replay preserves choices", async () => {
		const f = fixture();
		let runtime = f.create();
		try {
			await runtime.runPromise(WizardService.save(draft));
			await runtime.dispose();
			runtime = f.create();
			expect(await runtime.runPromise(snapshot)).toMatchObject({
				locale: "de",
				step: "profiles",
				completed: false,
				profileIds: ["local"],
			});
			expect(await runtime.runPromise(WizardService.complete())).toMatchObject({
				completed: true,
				step: "complete",
				hardwareVerified: false,
			});
			const saved = f.disk(),
				writes = f.writes();
			await runtime.runPromise(WizardService.complete());
			expect(f.disk()).toEqual(saved);
			expect(f.writes()).toBe(writes);
			expect(
				await runtime.runPromise(Effect.either(WizardService.save(draft))),
			).toMatchObject({ _tag: "Left", left: { _tag: "WizardIncomplete" } });
			await runtime.runPromise(WizardService.replay());
			expect(await runtime.runPromise(snapshot)).toMatchObject({
				completed: false,
				step: "welcome",
				locale: "de",
				profileIds: ["local"],
				display: { _tag: "desktop-preview" },
			});
			await runtime.runPromise(WizardService.complete());
			expect(await runtime.runPromise(snapshot)).toMatchObject({
				completed: true,
				profileIds: ["local"],
			});
		} finally {
			await runtime.dispose();
		}
	});
	it("failed completion preserves the last durable progress and cause across restart", async () => {
		const f = fixture();
		let runtime = f.create();
		try {
			await runtime.runPromise(WizardService.save(draft));
			const saved = f.disk();
			f.failWrite();
			const result = await runtime.runPromise(
				Effect.either(WizardService.complete()),
			);
			expect(result).toMatchObject({
				_tag: "Left",
				left: { code: "QUAKE.SETTINGS.PERSIST_FAILED" },
			});
			if (
				result._tag === "Left" &&
				result.left instanceof SettingsPersistFailed
			) {
				expect(result.left.originalCause).toBe(f.cause);
				expect(JSON.stringify(result.left)).not.toContain(
					"private-do-not-serialize",
				);
			}
			expect(await runtime.runPromise(snapshot)).toMatchObject({
				completed: false,
			});
			expect(f.disk()).toEqual(saved);
			await runtime.dispose();
			runtime = f.create();
			expect(await runtime.runPromise(snapshot)).toMatchObject({
				completed: false,
			});
		} finally {
			await runtime.dispose();
		}
	});
	it.each([
		{},
		{ locale: "de" },
		{ ...draft, profileIds: [] },
		{ ...draft, display: { _tag: "quake", deviceId: "missing" } },
	])(
		"rejects incomplete/unavailable choices without a completion write: %j",
		async (choices) => {
			const f = fixture(),
				runtime = f.create();
			try {
				await runtime.runPromise(
					WizardService.save({ step: "profiles", ...choices }),
				);
				const saved = f.disk(),
					writes = f.writes();
				expect(
					await runtime.runPromise(Effect.either(WizardService.complete())),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.WIZARD.INCOMPLETE" },
				});
				expect(f.disk()).toEqual(saved);
				expect(f.writes()).toBe(writes);
			} finally {
				await runtime.dispose();
			}
		},
	);
	it("checks current owner state, accepts an explicit runtime skip and never installs a runtime", async () => {
		const f = fixture(),
			runtime = f.create();
		f.runtime(false);
		try {
			await runtime.runPromise(WizardService.save(draft));
			expect(
				await runtime.runPromise(Effect.either(WizardService.complete())),
			).toMatchObject({ _tag: "Left" });
			await runtime.runPromise(
				WizardService.save({ step: "runtime", runtime: "configured" }),
			);
			expect(
				await runtime.runPromise(Effect.either(WizardService.complete())),
			).toMatchObject({ _tag: "Left" });
			await runtime.runPromise(
				WizardService.save({ step: "runtime", runtime: "skipped" }),
			);
			expect(await runtime.runPromise(WizardService.complete())).toMatchObject({
				completed: true,
				runtime: "skipped",
			});
		} finally {
			await runtime.dispose();
		}
	});
	it("rejects a profile removed since selection and does not substitute another device", async () => {
		const f = fixture(),
			runtime = f.create();
		try {
			f.deviceAvailable();
			await runtime.runPromise(
				WizardService.save({
					...draft,
					display: { _tag: "quake", deviceId: "selected-A" },
				}),
			);
			f.unavailable();
			expect(
				await runtime.runPromise(Effect.either(WizardService.complete())),
			).toMatchObject({ _tag: "Left", left: { _tag: "WizardIncomplete" } });
			expect(await runtime.runPromise(snapshot)).toMatchObject({
				completed: false,
				display: { deviceId: "selected-A" },
			});
		} finally {
			await runtime.dispose();
		}
	});
	it("preserves future fields and explicit provider/speech choices during suggestions, locale changes and restart", async () => {
		const f = fixture({
			...legacy,
			provider: { selected: "mine", credentialRef: "opaque-reference" },
			speech: { selected: "my-speech" },
			future: { keep: [1] },
			general: {
				version: 1,
				launchAtLogin: false,
				startHidden: false,
				future: { keep: 2 },
			},
			wizard: {
				version: 1,
				step: "welcome",
				localeConfirmed: false,
				profileIds: [],
				runtime: "unselected",
				completed: false,
				future: { keep: 3 },
			},
		});
		let runtime = f.create();
		try {
			await runtime.runPromise(WizardService.seedRegion("DE"));
			await runtime.runPromise(
				WizardService.save({ step: "display", locale: "de" }),
			);
			await runtime.runPromise(WizardService.seedRegion("US"));
			await runtime.runPromise(
				GeneralSettingsService.save({ startHidden: true }),
			);
			expect(f.seeds()).toBe(1);
			expect(f.disk()).toMatchObject({
				locale: "de",
				provider: { selected: "mine", credentialRef: "opaque-reference" },
				speech: { selected: "my-speech" },
				future: { keep: [1] },
				general: { future: { keep: 2 } },
				wizard: { region: "DE", future: { keep: 3 } },
			});
			const publicViews = JSON.stringify([
				await runtime.runPromise(snapshot),
				await runtime.runPromise(GeneralSettingsService.snapshot()),
			]);
			expect(publicViews).not.toContain("opaque-reference");
			expect(publicViews).not.toContain("future");
			await runtime.dispose();
			runtime = f.create();
			expect(await runtime.runPromise(snapshot)).toMatchObject({
				locale: "de",
				region: "DE",
			});
		} finally {
			await runtime.dispose();
		}
	});
	it("keeps login and hidden-start independent, reports denied OS writes with saved intent and live status", async () => {
		const f = fixture(),
			runtime = f.create();
		try {
			await runtime.runPromise(
				GeneralSettingsService.save({ startHidden: true }),
			);
			expect(f.loginWrites).toEqual([]);
			expect(
				await runtime.runPromise(GeneralSettingsService.startup()),
			).toEqual({ hidden: false });
			f.reachable();
			expect(
				await runtime.runPromise(GeneralSettingsService.startup()),
			).toEqual({ hidden: true });
			f.denyLogin();
			const result = await runtime.runPromise(
				Effect.either(GeneralSettingsService.save({ launchAtLogin: true })),
			);
			expect(result).toMatchObject({
				_tag: "Left",
				left: { code: "QUAKE.SETTINGS.OS_APPLY_FAILED" },
			});
			if (
				result._tag === "Left" &&
				result.left instanceof SettingsOsApplyFailed
			) {
				expect(result.left.originalCause).toBe(f.cause);
				expect(JSON.stringify(result.left)).not.toContain(
					"private-do-not-serialize",
				);
			}
			expect(
				await runtime.runPromise(GeneralSettingsService.snapshot()),
			).toMatchObject({ launchAtLogin: true, startHidden: true });
			expect(
				await runtime.runPromise(GeneralSettingsService.loginStatus()),
			).toBe(false);
		} finally {
			await runtime.dispose();
		}
	});
	it("does no OS write on persistence/validation failure, and clamps off-screen saved bounds", async () => {
		const f = fixture(),
			runtime = f.create();
		try {
			await runtime.runPromise(
				GeneralSettingsService.save({
					window: { x: 8000, y: 9000, width: 3000, height: 2000 },
				}),
			);
			expect(
				await runtime.runPromise(GeneralSettingsService.startup()),
			).toEqual({
				hidden: false,
				window: { x: -1920, y: 0, width: 1920, height: 1080 },
			});
			const writes = f.writes();
			expect(
				await runtime.runPromise(
					Effect.either(GeneralSettingsService.save({ launchAtLogin: "yes" })),
				),
			).toMatchObject({ _tag: "Left", left: { _tag: "SettingsInvalid" } });
			expect(f.writes()).toBe(writes);
			f.failWrite();
			expect(
				await runtime.runPromise(
					Effect.either(GeneralSettingsService.save({ launchAtLogin: true })),
				),
			).toMatchObject({
				_tag: "Left",
				left: { _tag: "SettingsPersistFailed" },
			});
			expect(f.loginWrites).toEqual([]);
		} finally {
			await runtime.dispose();
		}
	});
	it.each([
		{ ...legacy, version: 2 },
		{ ...legacy, general: { version: 99 } },
		{ ...legacy, wizard: { version: 2 } },
		{
			...legacy,
			wizard: {
				version: 1,
				step: "complete",
				completed: true,
				localeConfirmed: false,
				profileIds: [],
				runtime: "unselected",
			},
		},
	])(
		"preserves corrupt/unsupported documents without reseeding: %j",
		async (saved) => {
			const f = fixture(saved),
				runtime = f.create();
			try {
				expect((await runtime.runPromiseExit(snapshot))._tag).toBe("Failure");
				expect(f.writes()).toBe(0);
				expect(f.disk()).toEqual(saved);
			} finally {
				await runtime.dispose();
			}
		},
	);
	it("doesn't replace an unreadable document", async () => {
		const f = fixture(),
			runtime = f.create();
		f.failRead();
		try {
			expect((await runtime.runPromiseExit(snapshot))._tag).toBe("Failure");
			expect(f.writes()).toBe(0);
		} finally {
			await runtime.dispose();
		}
	});
	it("cancels owner validation before the completion commit", async () => {
		const f = fixture(),
			runtime = f.create();
		try {
			await runtime.runPromise(WizardService.save(draft));
			const saved = f.disk();
			const entered = await Effect.runPromise(Deferred.make<void>());
			f.gateOwner(
				Deferred.succeed(entered, undefined).pipe(
					Effect.zipRight(Effect.never),
				),
			);
			const fiber = runtime.runFork(WizardService.complete());
			await Effect.runPromise(Deferred.await(entered));
			await Effect.runPromise(Fiber.interrupt(fiber));
			expect(f.disk()).toEqual(saved);
			expect(await runtime.runPromise(snapshot)).toMatchObject({
				completed: false,
			});
		} finally {
			await runtime.dispose();
		}
	});
	it("finishes an in-flight atomic write under cancellation and agrees with a restarted consumer", async () => {
		const f = fixture();
		let runtime = f.create();
		try {
			await runtime.runPromise(WizardService.save(draft));
			const entered = await Effect.runPromise(Deferred.make<void>()),
				release = await Effect.runPromise(Deferred.make<void>());
			f.gateWrite(
				Deferred.succeed(entered, undefined).pipe(
					Effect.zipRight(Deferred.await(release)),
				),
			);
			const fiber = runtime.runFork(WizardService.complete());
			await Effect.runPromise(Deferred.await(entered));
			await Effect.runPromise(Fiber.interruptFork(fiber));
			await Effect.runPromise(Deferred.succeed(release, undefined));
			await Effect.runPromise(Fiber.await(fiber));
			expect(await runtime.runPromise(snapshot)).toMatchObject({
				completed: true,
			});
			await runtime.dispose();
			runtime = f.create();
			expect(await runtime.runPromise(snapshot)).toMatchObject({
				completed: true,
			});
		} finally {
			await runtime.dispose();
		}
	});
	it("catalog wizard failures retain private causes without serializing sensitive text", () => {
		const cause = new Error("private-token");
		const error = new WizardIncomplete(cause);
		expect(error.originalCause).toBe(cause);
		expect(JSON.stringify(error)).not.toContain("private-token");
		expect(error.code).toBe("QUAKE.WIZARD.INCOMPLETE");
	});
});

it("regional suggestions don't mutate configured models in the canonical AgentsRepository", async () => {
	const { initialAgentState } = await import("../agents/agents-invariants.js");
	const { AgentsRepository, AgentStorage } = await import(
		"../agents/agents-repository.js"
	);
	const state = initialAgentState();
	const configured = {
		...state,
		models: {
			default: [
				{
					id: "chosen",
					role: "default" as const,
					provider: "my-provider",
					model: "my-model",
					baseUrl: "https://provider.example/v1",
					maxTokens: 2048,
					credentialRef: "canonical-protected-reference",
				},
			],
		},
	};
	let modelWrites = 0;
	const f = fixture();
	const wizard = f.create();
	const models = ManagedRuntime.make(
		AgentsRepository.Default.pipe(
			Layer.provide(
				Layer.succeed(AgentStorage, {
					read: () => Effect.succeed(Option.some(configured)),
					write: () =>
						Effect.sync(() => {
							modelWrites++;
						}),
				}),
			),
		),
	);
	try {
		const before = await models.runPromise(
			AgentsRepository.use((repo) => repo.read()),
		);
		await wizard.runPromise(WizardService.seedRegion("DE"));
		await wizard.runPromise(
			WizardService.save({ step: "display", locale: "de", region: "US" }),
		);
		await wizard.runPromise(WizardService.seedRegion("FR"));
		expect(
			await models.runPromise(AgentsRepository.use((repo) => repo.read())),
		).toEqual(before);
		expect(modelWrites).toBe(0);
		expect(JSON.stringify(await wizard.runPromise(snapshot))).not.toContain(
			"canonical-protected-reference",
		);
	} finally {
		await wizard.dispose();
		await models.dispose();
	}
});

it("seeds on the first explicit region save and keeps local use available if optional runtime support disappears", async () => {
	const f = fixture();
	f.runtime(true);
	let runtime = f.create();
	try {
		await runtime.runPromise(
			WizardService.save({ ...draft, runtime: "configured" }),
		);
		expect(f.seeds()).toBe(1);
		await runtime.dispose();
		const saved = f.disk();
		const restored = fixture(saved);
		runtime = restored.create();
		await runtime.runPromise(
			WizardService.save({ step: "profiles", region: "US" }),
		);
		expect(restored.seeds()).toBe(1);
		expect(await runtime.runPromise(WizardService.complete())).toMatchObject({
			completed: true,
			runtime: "configured",
			region: "US",
		});
	} finally {
		await runtime.dispose();
	}
});

it("retains a failed owner prerequisite's catalog identity and private cause through completion", async () => {
	const f = fixture();
	const runtime = f.create();
	try {
		await runtime.runPromise(WizardService.save(draft));
		const failure = new WizardIncomplete(f.cause);
		f.gateOwner(Effect.fail(failure));
		const result = await runtime.runPromise(
			Effect.either(WizardService.complete()),
		);
		expect(result).toMatchObject({
			_tag: "Left",
			left: { code: "QUAKE.WIZARD.INCOMPLETE" },
		});
		if (result._tag === "Left") {
			// Effect tracing can wrap the same leaf in a span proxy. Assert catalog/class identity and retained cause.
			expect(result.left).toBeInstanceOf(WizardIncomplete);
			expect(result.left.originalCause).toBe(f.cause);
			expect(JSON.stringify(result.left)).not.toContain(
				"private-do-not-serialize",
			);
		}
		expect(await runtime.runPromise(snapshot)).toMatchObject({
			completed: false,
		});
	} finally {
		await runtime.dispose();
	}
});

it("keeps conductor spans in one parent trace without recording draft or credential data", async () => {
	const f = fixture();
	const runtime = f.create();
	const spans: Tracer.Span[] = [];
	const tracer = await Effect.runPromise(
		Tracer.tracerWith((original) =>
			Effect.succeed(
				Tracer.make({
					context: original.context,
					span: (...args) => {
						const span = original.span(...args);
						spans.push(span);
						return span;
					},
				}),
			),
		),
	);
	try {
		await runtime.runPromise(
			Effect.gen(function* () {
				yield* WizardService.save({
					...draft,
					profileIds: ["private-profile-id"],
				});
				yield* GeneralSettingsService.save({ startHidden: true });
				yield* WizardService.complete();
			}).pipe(
				Effect.withSpan("Settings.acceptance"),
				Effect.withTracer(tracer),
			),
		);
		expect(spans.map((span) => span.name)).toEqual(
			expect.arrayContaining([
				"WizardService.save",
				"WizardService.complete",
				"GeneralSettingsService.save",
				"SettingsRepository.transact",
			]),
		);
		expect(new Set(spans.map((span) => span.traceId)).size).toBe(1);
		const metadata = JSON.stringify(
			spans.map((span) => ({
				name: span.name,
				attributes: [...span.attributes],
			})),
		);
		expect(metadata).not.toContain("private-profile-id");
		expect(metadata).not.toContain("credential");
	} finally {
		await runtime.dispose();
	}
});

it("refreshes advisory suggestions only when an explicit region changes, preserving chosen locale and providers", async () => {
	const f = fixture({
		...legacy,
		provider: { selected: "mine" },
		speech: { selected: "my-speech" },
	});
	const runtime = f.create();
	try {
		expect(
			await runtime.runPromise(
				WizardService.save({
					step: "locale-region",
					locale: "de",
					region: "DE",
				}),
			),
		).toMatchObject({ suggestions: { provider: "provider-DE" } });
		expect(
			await runtime.runPromise(
				WizardService.save({ step: "display", region: "US" }),
			),
		).toMatchObject({
			locale: "de",
			region: "US",
			suggestions: { provider: "provider-US" },
		});
		await runtime.runPromise(
			WizardService.save({ step: "profiles", region: "US" }),
		);
		expect(f.seeds()).toBe(2);
		expect(f.disk()).toMatchObject({
			provider: { selected: "mine" },
			speech: { selected: "my-speech" },
		});
	} finally {
		await runtime.dispose();
	}
});
