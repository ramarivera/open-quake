import { Effect, type ManagedRuntime, Option, Schema } from "effect";
import {
	type Profile,
	ProfileDraft,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileManager } from "../../../../../packages/device/src/profiles/profile-manager-service.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import { ProfileSwitching } from "../../../../../packages/device/src/profiles/profile-switching-service.js";
import {
	type Agent,
	SLOT_CODES,
	type Slots,
} from "../../../../../packages/edge/src/agents/agents-contracts.js";
import {
	type AgentError,
	AgentPanelFailed,
	AgentProfileMissing,
	AgentRollbackFailed,
	AgentSlotInvalid,
} from "../../../../../packages/edge/src/agents/agents-errors.js";
import type {
	AgentPanelPort,
	AgentPanelTransaction,
} from "../../../../../packages/edge/src/agents/agents-ports.js";
export type ProfilesRuntime = ManagedRuntime.ManagedRuntime<
	ProfileService | ProfileManager | ProfileSwitching,
	never
>;
const profileId = "1-8";
export function agentProfileBinding(
	runtime: ProfilesRuntime,
): typeof AgentPanelPort.Service {
	const external = <A>(
		f: () => Promise<A>,
	): Effect.Effect<A, AgentPanelFailed> =>
		Effect.tryPromise({
			try: f,
			catch: (cause) => new AgentPanelFailed(cause),
		});
	return {
		prepare: Effect.fn("AgentsPanel.prepare")(function* (
			slots: Slots,
			agents: readonly Agent[],
		): Effect.fn.Return<AgentPanelTransaction, AgentError> {
			const envelope = yield* external(() =>
				runtime.runPromise(ProfileManager.read()),
			);
			const previous = envelope.profiles.find((p) => p.id === profileId);
			if (!previous) return yield* new AgentProfileMissing();
			const page = previous.pages[0];
			if (
				SLOT_CODES.some(
					(code) =>
						page.keys.filter(
							(k) => k.keyCode === code && k.config.type === "clawbot",
						).length !== 1,
				)
			)
				return yield* new AgentSlotInvalid();
			const patched: Profile = {
				...previous,
				pages: [
					{
						...page,
						keys: page.keys.map((key) => {
							const code = SLOT_CODES.find((code) => code === key.keyCode);
							if (!code) return key;
							const agent = agents.find((a) => a.id === slots[code]);
							if (!agent) return key;
							return {
								...key,
								config: {
									...key.config,
									title: { ...key.config.title, text: agent.name },
									actions: [
										...key.config.actions.filter((a) => a.type !== "agentId"),
										{ type: "agentId", value: agent.id },
									],
								},
							};
						}),
					},
					...previous.pages.slice(1),
				],
			};
			// ProfileService.saveProfile decodes the encoded Draft and compares expectedRevision.
			let savedRevision: Option.Option<number> = Option.none();
			const save = (profile: Profile, expectedRevision: number) =>
				external(() =>
					runtime.runPromise(
						ProfileService.saveProfile({
							expectedRevision,
							profile: Schema.encodeSync(ProfileDraft)(profile),
						}),
					),
				);
			return {
				apply: Effect.fn("AgentsPanel.apply")(function* (): Effect.fn.Return<
					boolean,
					AgentError
				> {
					const saved = yield* save(patched, previous.revision);
					const current = saved.profiles.find((p) => p.id === profileId);
					if (!current) return yield* new AgentPanelFailed();
					savedRevision = Option.some(current.revision);
					return yield* external(() =>
						runtime.runPromise(
							Effect.flatMap(ProfileSwitching, (service) =>
								service.redeliverSelected(profileId),
							),
						),
					);
				})(),
				rollback: Effect.fn("AgentsPanel.rollback")(
					function* (): Effect.fn.Return<void, AgentError> {
						if (Option.isNone(savedRevision)) return;
						yield* save(previous, savedRevision.value).pipe(
							Effect.catchTag("AgentPanelFailed", (cause) =>
								Effect.fail(new AgentRollbackFailed(cause)),
							),
						);
						yield* external(() =>
							runtime.runPromise(
								Effect.flatMap(ProfileSwitching, (service) =>
									service.redeliverSelected(profileId),
								),
							),
						).pipe(
							Effect.catchTag("AgentPanelFailed", (cause) =>
								Effect.fail(new AgentRollbackFailed(cause)),
							),
						);
					},
				)(),
			};
		}),
	};
}
