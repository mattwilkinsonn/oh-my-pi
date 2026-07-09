import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";

/**
 * Atomically write `data` to `targetPath` while preserving a symlink at
 * `targetPath`. OMP-managed config (e.g. `config.yml`) is often a symlink into a
 * dotfiles/nix checkout; a plain `rename` onto the link path clobbers the link
 * into a regular file — stranding the repo copy and forcing a re-symlink. We
 * resolve the link to its real target first, then write a sibling temp file and
 * `rename` it onto the real path: the link stays intact and the write is
 * crash-atomic (no truncate-in-place window). Suitable for any file a user might
 * symlink, not just config.
 */
export async function atomicWriteThroughSymlink(targetPath: string, data: string): Promise<void> {
	let realPath = targetPath;
	try {
		if ((await fs.lstat(targetPath)).isSymbolicLink()) {
			try {
				realPath = await fs.realpath(targetPath);
			} catch (error) {
				if (!isEnoent(error)) throw error;
				// Dangling link (referent not created yet — e.g. a first-run config.yml
				// symlink into a dotfiles checkout). Resolve the link's referent relative
				// to the link dir and write there, so the link itself is preserved rather
				// than clobbered into a regular file.
				const referent = await fs.readlink(targetPath);
				realPath = path.resolve(path.dirname(targetPath), referent);
			}
		}
	} catch (error) {
		// Nothing at the path — write at the path itself.
		if (!isEnoent(error)) throw error;
	}

	// Preserve the real target's permissions: Bun.write creates the temp with the
	// default mode (0644), and the rename would otherwise widen a tightened
	// (e.g. 0600) config that can hold secrets. Stat before writing; apply the
	// mode to the temp before it takes the target's place.
	let mode: number | undefined;
	try {
		mode = (await fs.stat(realPath)).mode;
	} catch (error) {
		if (!isEnoent(error)) throw error;
	}

	const tmpPath = path.join(path.dirname(realPath), `.${path.basename(realPath)}.${process.pid}.${Date.now()}.tmp`);
	try {
		await Bun.write(tmpPath, data);
		if (mode !== undefined) await fs.chmod(tmpPath, mode & 0o777);
		await fs.rename(tmpPath, realPath);
	} catch (error) {
		await fs.rm(tmpPath, { force: true }).catch(() => {});
		throw error;
	}
}
