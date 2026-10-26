import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
	Cause,
	Context,
	Effect,
	Exit,
	FiberRef,
	FiberRefs,
	Layer,
	Logger,
	Option,
	Tracer,
} from "effect";
import {
	type CaptureMetrics,
	safeCaptureMetrics,
} from "../speech/capture-metrics";
import {
	createDiagnosticStorage,
	type DiagnosticStatus,
	type DiagnosticStorageOptions,
} from "./persistence.js";
import {
	type DiagnosticOperation,
	safeCause,
	safeError,
	safeLogEvent,
	safeSpanName,
} from "./privacy.js";

export type {
	DiagnosticStatus,
	DiagnosticStorageOptions,
} from "./persistence.js";
export type { DiagnosticOperation } from "./privacy.js";

export interface DesktopDiagnostics {
	readonly layer: Layer.Layer<never>;
	readonly recordCapture?: (metrics: CaptureMetrics) => Effect.Effect<void>;
	/** Main-owned request scope. Wrap BEFORE catch/match so failed exits remain observable. */
	readonly instrument: <A, E, R>(
		effect: Effect.Effect<A, E, R>,
		operation: DiagnosticOperation,
	) => Effect.Effect<A, E, R>;
	/** Capture only the active diagnostic context when registering an asynchronous callback. */
	readonly bind: <Args extends readonly unknown[], Result>(
		callback: (...args: Args) => Result,
	) => (...args: Args) => Result;
	readonly flush: () => Promise<DiagnosticStatus>;
	/** Dispose all runtimes first, then close once to drain logs and fsync the current file. */
	readonly close: () => Promise<DiagnosticStatus>;
	readonly status: () => DiagnosticStatus;
}

/** One instance per process; its layer is shared by all desktop runtimes. No network transport. */
export function createDesktopDiagnostics(
	options: DiagnosticStorageOptions,
): DesktopDiagnostics {
	const storage = createDiagnosticStorage(options);
	const sessionId = randomUUID();
	const requestId = FiberRef.unsafeMake<Option.Option<string>>(Option.none());
	const asyncContext = new AsyncLocalStorage<{
		span: Option.Option<Tracer.AnySpan>;
		requestId: Option.Option<string>;
	}>();
	const capture = () => {
		const current = asyncContext.getStore();
		return current
			? {
					span: Option.map(current.span, (span) =>
						Tracer.externalSpan({
							traceId: span.traceId,
							spanId: span.spanId,
							sampled: span.sampled,
						}),
					),
					requestId: current.requestId,
				}
			: undefined;
	};
	const requestBySpan = new WeakMap<Tracer.AnySpan, string>();
	let sequence = 0;
	const emit = (record: object) =>
		storage.emit({
			schema: 1,
			session_id: sessionId,
			sequence: ++sequence,
			time: new Date().toISOString(),
			...record,
		});
	const correlation = (
		span: Option.Option<Tracer.AnySpan>,
		request: Option.Option<string>,
	) => ({
		...(Option.isSome(span)
			? {
					...(/^[0-9a-f]{32}$/.test(span.value.traceId)
						? { trace_id: span.value.traceId }
						: {}),
					...(/^[0-9a-f]{16}$/.test(span.value.spanId)
						? { span_id: span.value.spanId }
						: {}),
					...(span.value._tag === "Span"
						? { span_name: safeSpanName(span.value.name) }
						: {}),
				}
			: { uncorrelated: true }),
		...(Option.isSome(request) ? { request_id: request.value } : {}),
	});
	const logger = Logger.make<unknown, void>(
		({ logLevel, message, cause, context }) => {
			const span = Context.getOption(
				FiberRefs.getOrDefault(context, FiberRef.currentContext),
				Tracer.ParentSpan,
			);
			try {
				const messages = Array.isArray(message) ? message : [message];
				// Ignore text and annotations entirely. Error arguments retain only the safe error projection.
				const errors = messages
					.slice(0, 8)
					.filter((value) => value instanceof Error)
					.map((error) => safeError(error));
				emit({
					type: "log",
					level: logLevel.label,
					event: safeLogEvent(messages),
					...correlation(span, FiberRefs.getOrDefault(context, requestId)),
					...(errors.length ? { errors } : {}),
					...(!Cause.isEmpty(cause) ? { cause: safeCause(cause) } : {}),
				});
			} catch {
				emit({
					type: "log",
					level: "ERROR",
					event: "diagnostics.projection_failed",
				});
			}
		},
	);
	const installedTracers = new WeakSet<object>();
	const tracerLayer = Layer.unwrapEffect(
		Effect.map(Effect.tracer, (native) => {
			if (installedTracers.has(native)) return Layer.empty;
			const tracer = Tracer.make({
				context: (f, fiber) =>
					asyncContext.run(
						{
							span: Context.getOption(fiber.currentContext, Tracer.ParentSpan),
							requestId: fiber.getFiberRef(requestId),
						},
						() => native.context(f, fiber),
					),
				span: (name, parent, context, links, startTime, kind, spanOptions) => {
					const span = native.span(
						name,
						parent,
						context,
						links,
						startTime,
						kind,
						spanOptions,
					);
					const currentRequest =
						asyncContext.getStore()?.requestId ?? Option.none();
					const inheritedRequest = Option.isSome(parent)
						? requestBySpan.get(parent.value)
						: undefined;
					const id = Option.isSome(currentRequest)
						? currentRequest.value
						: inheritedRequest;
					if (id) requestBySpan.set(span, id);
					const end = span.end.bind(span);
					let ended = false;
					span.end = (endTime, exit) => {
						end(endTime, exit);
						if (ended) return;
						ended = true;
						emit({
							type: "span",
							...correlation(Option.some(span), Option.fromNullable(id)),
							...(Option.isSome(parent) &&
							/^[0-9a-f]{16}$/.test(parent.value.spanId)
								? { parent_span_id: parent.value.spanId }
								: {}),
							duration_ms: Math.max(0, Number(endTime - startTime) / 1e6),
							outcome: Exit.isSuccess(exit)
								? "success"
								: Cause.isInterruptedOnly(exit.cause)
									? "interrupted"
									: "failure",
							...(Exit.isFailure(exit) ? { cause: safeCause(exit.cause) } : {}),
						});
					};
					return span;
				},
			});
			installedTracers.add(tracer);
			return Layer.setTracer(tracer);
		}),
	);
	const layer = Layer.mergeAll(
		Logger.replace(Logger.defaultLogger, logger),
		tracerLayer,
	);
	const instrument: DesktopDiagnostics["instrument"] = (effect, operation) => {
		// Capture at the Promise boundary, before another runtime starts its own fiber.
		const inherited = capture();
		return Effect.gen(function* () {
			const active = yield* Effect.currentSpan.pipe(Effect.option);
			const currentRequest = yield* FiberRef.get(requestId);
			const id = Option.getOrElse(currentRequest, () =>
				Option.getOrElse(inherited?.requestId ?? Option.none(), randomUUID),
			);
			let work = effect.pipe(
				Effect.withSpan(safeSpanName(operation), { captureStackTrace: false }),
			);
			if (Option.isNone(active) && inherited && Option.isSome(inherited.span))
				work = work.pipe(Effect.withParentSpan(inherited.span.value));
			return yield* work.pipe(Effect.locally(requestId, Option.some(id)));
		});
	};
	const bind: DesktopDiagnostics["bind"] = (callback) => {
		const captured = capture();
		return (...args) =>
			captured
				? asyncContext.run(captured, () => callback(...args))
				: callback(...args);
	};
	let closing: Promise<DiagnosticStatus> | undefined;
	const close = (): Promise<DiagnosticStatus> => {
		if (closing) return closing;
		closing = (async () => {
			const health = await storage.flush();
			emit({
				type: "health",
				event: "diagnostics.shutdown",
				written: health.written,
				dropped: health.dropped,
				storageFailures: health.storageFailures,
				...(health.lastFailure ? { lastFailure: health.lastFailure } : {}),
			});
			return storage.close();
		})();
		return closing;
	};
	return {
		recordCapture: (metrics) =>
			Effect.sync(() =>
				emit({ type: "capture", ...safeCaptureMetrics(metrics) }),
			),
		layer,
		bind,
		instrument,
		flush: storage.flush,
		close,
		status: storage.status,
	};
}
