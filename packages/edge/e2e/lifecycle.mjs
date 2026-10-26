// Never persist subprocess output: provider errors can encode credentials.
export function failureDiagnostic(binary, error) {
	return JSON.stringify({
		command: binary,
		exitCode: Number.isInteger(error.code) ? error.code : null,
		signal: /^SIG[A-Z]+$/.test(error.signal ?? "") ? error.signal : null,
		outputOmitted: true,
	});
}

export async function cleanupProject({
	project,
	compose,
	command,
	removeState,
	removeSecrets = async () => {},
}) {
	try {
		await compose(["down", "--volumes", "--remove-orphans"], 60000);
		const filter = `label=com.docker.compose.project=${project}`;
		const inventories = await Promise.all([
			command("docker", ["ps", "-aq", "--filter", filter]),
			command("docker", ["network", "ls", "-q", "--filter", filter]),
			command("docker", ["volume", "ls", "-q", "--filter", filter]),
		]);
		if (inventories.some(({ stdout }) => stdout.trim()))
			throw new Error("Compose resources survived cleanup");
		// Preserve recovery state on every failure, including inventory errors.
		await removeState();
	} finally {
		// Retained recovery state must not retain plaintext profile credentials.
		await removeSecrets();
	}
}
