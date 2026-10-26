import type { SpawnOptions } from "node:child_process";
import { AgentRuntimeFailed } from "../../../../../packages/edge/src/agents/agents-errors";
import type { OwnedRuntimeProcess } from "./owned-runtime";

interface ProcessHandles {
	readonly process: unknown;
	readonly thread: unknown;
}
export interface WindowsJobApi {
	readonly createJob: () => unknown;
	readonly createSuspended: (
		executable: string,
		commandLine: string,
		environment: Buffer,
	) => ProcessHandles;
	readonly assign: (job: unknown, process: unknown) => void;
	readonly resume: (thread: unknown) => void;
	readonly exited: (process: unknown) => boolean;
	readonly active: (job: unknown) => number;
	readonly terminateJob: (job: unknown) => void;
	readonly terminateProcess: (process: unknown) => void;
	readonly close: (handle: unknown) => void;
}

async function nativeApi(): Promise<WindowsJobApi> {
	const k = await import("koffi");
	const library = k.load("kernel32.dll");
	const startup = k.struct({
		cb: "uint32_t",
		reserved: "void *",
		desktop: "void *",
		title: "void *",
		x: "uint32_t",
		y: "uint32_t",
		width: "uint32_t",
		height: "uint32_t",
		xChars: "uint32_t",
		yChars: "uint32_t",
		fill: "uint32_t",
		flags: "uint32_t",
		show: "uint16_t",
		reservedBytes: "uint16_t",
		reservedData: "void *",
		input: "void *",
		output: "void *",
		error: "void *",
	});
	const information = k.struct({
		process: "void *",
		thread: "void *",
		pid: "uint32_t",
		tid: "uint32_t",
	});
	const limits = k.struct({
		processTime: "int64_t",
		jobTime: "int64_t",
		flags: "uint32_t",
		minWorkingSet: "uintptr_t",
		maxWorkingSet: "uintptr_t",
		active: "uint32_t",
		affinity: "uintptr_t",
		priority: "uint32_t",
		scheduling: "uint32_t",
	});
	const io = k.struct({
		readOps: "uint64_t",
		writeOps: "uint64_t",
		otherOps: "uint64_t",
		readBytes: "uint64_t",
		writeBytes: "uint64_t",
		otherBytes: "uint64_t",
	});
	const extended = k.struct({
		basic: limits,
		io,
		processMemory: "uintptr_t",
		jobMemory: "uintptr_t",
		peakProcessMemory: "uintptr_t",
		peakJobMemory: "uintptr_t",
	});
	const accounting = k.struct({
		user: "int64_t",
		kernel: "int64_t",
		periodUser: "int64_t",
		periodKernel: "int64_t",
		faults: "uint32_t",
		total: "uint32_t",
		active: "uint32_t",
		terminated: "uint32_t",
	});
	const createJob: (attributes: null, name: null) => unknown = library.func(
		"void * __stdcall CreateJobObjectW(void *attributes, void *name)",
	);
	const setLimits: (
		job: unknown,
		kind: number,
		info: Buffer,
		size: number,
	) => number = library.func(
		"int32_t __stdcall SetInformationJobObject(void *job, int kind, void *info, uint32_t size)",
	);
	const create: (
		exe: string | null,
		line: Buffer,
		pa: null,
		ta: null,
		inherit: number,
		flags: number,
		env: Buffer,
		cwd: null,
		startup: unknown,
		info: unknown,
	) => number = library.func("__stdcall", "CreateProcessW", "int32_t", [
		"str16",
		"void *",
		"void *",
		"void *",
		"int32_t",
		"uint32_t",
		"void *",
		"void *",
		k.pointer(startup),
		k.out(k.pointer(information)),
	]);
	const assign: (job: unknown, process: unknown) => number = library.func(
		"int32_t __stdcall AssignProcessToJobObject(void *job, void *process)",
	);
	const resume: (thread: unknown) => number = library.func(
		"uint32_t __stdcall ResumeThread(void *thread)",
	);
	const wait: (process: unknown, timeout: number) => number = library.func(
		"uint32_t __stdcall WaitForSingleObject(void *process, uint32_t timeout)",
	);
	const query: (
		job: unknown,
		kind: number,
		info: unknown,
		size: number,
		returned: null,
	) => number = library.func(
		"__stdcall",
		"QueryInformationJobObject",
		"int32_t",
		["void *", "int", k.out(k.pointer(accounting)), "uint32_t", "void *"],
	);
	const terminateJob: (job: unknown, code: number) => number = library.func(
		"int32_t __stdcall TerminateJobObject(void *job, uint32_t code)",
	);
	const terminateProcess: (process: unknown, code: number) => number =
		library.func(
			"int32_t __stdcall TerminateProcess(void *process, uint32_t code)",
		);
	const close: (handle: unknown) => number = library.func(
		"int32_t __stdcall CloseHandle(void *handle)",
	);
	const check = (ok: number | boolean) => {
		if (!ok) throw new AgentRuntimeFailed();
	};
	return {
		createJob: () => {
			const job = createJob(null, null);
			if (!job) throw new AgentRuntimeFailed();
			const info = Buffer.alloc(k.sizeof(extended));
			// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. Kernel ownership also survives
			// a controller crash; no descendant may request breakaway.
			info.writeUInt32LE(
				0x2000,
				k.offsetof(extended, "basic") + k.offsetof(limits, "flags"),
			);
			if (!setLimits(job, 9, info, info.length)) {
				close(job);
				throw new AgentRuntimeFailed();
			}
			return job;
		},
		createSuspended: (_exe, line, environment) => {
			const info = { process: null, thread: null, pid: 0, tid: 0 };
			const si = { cb: k.sizeof(startup), flags: 1, show: 0 };
			check(
				create(
					null,
					Buffer.from(`${line}\0`, "utf16le"),
					null,
					null,
					0,
					0x08000404,
					environment,
					null,
					si,
					info,
				),
			);
			return info;
		},
		assign: (job, process) => check(assign(job, process)),
		resume: (thread) => check(resume(thread) !== 0xffffffff),
		exited: (process) => {
			const state = wait(process, 0);
			if (state === 0xffffffff) throw new AgentRuntimeFailed();
			return state === 0;
		},
		active: (job) => {
			const info = {
				user: 0,
				kernel: 0,
				periodUser: 0,
				periodKernel: 0,
				faults: 0,
				total: 0,
				active: 0,
				terminated: 0,
			};
			check(query(job, 1, info, k.sizeof(accounting), null));
			return info.active;
		},
		terminateJob: (job) => check(terminateJob(job, 1)),
		terminateProcess: (process) => check(terminateProcess(process, 1)),
		close: (handle) => {
			check(close(handle));
		},
	};
}

/** Create suspended, assign to the owned kernel job, then resume. This ordering
 * prevents descendants from starting outside the job. Cleanup targets a job
 * handle, so root exit and PID reuse cannot change what gets terminated.
 */
export async function startWindowsJob(
	executable: string,
	args: readonly string[],
	options: SpawnOptions,
	providedApi?: WindowsJobApi,
): Promise<OwnedRuntimeProcess> {
	const api = providedApi ?? (await nativeApi());
	const quote = (value: string) =>
		`"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
	const commandLine = [
		quote(executable),
		...(options.windowsVerbatimArguments ? args : args.map(quote)),
	].join(" ");
	const environment = Buffer.from(
		`${Object.entries(options.env ?? process.env)
			.filter((entry): entry is [string, string] => entry[1] !== undefined)
			.sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
			.map(([key, value]) => `${key}=${value}`)
			.join("\0")}\0\0`,
		"utf16le",
	);
	const job = api.createJob();
	let handles: ProcessHandles;
	try {
		handles = api.createSuspended(executable, commandLine, environment);
	} catch (cause) {
		api.close(job);
		throw cause;
	}
	let assigned = false;
	let launchFailed = false;
	try {
		api.assign(job, handles.process);
		assigned = true;
		api.resume(handles.thread);
	} catch {
		// Return an exited startup candidate so the lifecycle retains ownership
		// even if terminating a suspended process fails and needs a later retry.
		launchFailed = true;
	}
	let jobClosed = false;
	let processClosed = false;
	let threadClosed = false;
	let complete: () => void = () => {};
	const exited = new Promise<void>((resolve) => {
		complete = resolve;
	});
	let watcher: ReturnType<typeof setInterval> | undefined;
	if (launchFailed) complete();
	else {
		watcher = setInterval(() => {
			try {
				if (!api.exited(handles.process)) return;
			} catch {
				// A query failure affects readiness, never cleanup ownership.
			}
			clearInterval(watcher);
			complete();
		}, 25);
		watcher.unref();
	}
	return {
		exited,
		stop: async () => {
			if (!jobClosed) {
				if (assigned) {
					if (api.active(job) > 0) api.terminateJob(job);
				} else if (!api.exited(handles.process)) {
					api.terminateProcess(handles.process);
				}
				const deadline = Date.now() + 1000;
				while (assigned ? api.active(job) > 0 : !api.exited(handles.process)) {
					if (Date.now() >= deadline) throw new AgentRuntimeFailed();
					await new Promise<void>((resolve) => setTimeout(resolve, 25));
				}
				api.close(job);
				jobClosed = true;
			}
			clearInterval(watcher);
			if (!threadClosed) {
				api.close(handles.thread);
				threadClosed = true;
			}
			if (!processClosed) {
				api.close(handles.process);
				processClosed = true;
			}
			complete();
		},
	};
}
