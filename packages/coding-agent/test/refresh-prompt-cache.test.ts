import { afterEach, beforeEach, describe, expect, it, spyOn, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { reset as resetCapabilities } from "@oh-my-pi/pi-coding-agent/capability";
import { resetActiveRulesForTests } from "@oh-my-pi/pi-coding-agent/capability/rule";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
// Register the discovery providers (skills/rules) as a side effect.
import "@oh-my-pi/pi-coding-agent/discovery";
import { TtsrManager } from "@oh-my-pi/pi-coding-agent/export/ttsr";
import { resetActiveSkillsForTests } from "@oh-my-pi/pi-coding-agent/extensibility/skills";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { setAgentDir } from "@oh-my-pi/pi-utils";

function createModel() {
	return buildModel({
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	});
}

function writeSkill(dir: string, name: string, description: string): void {
	const file = path.join(dir, name, "SKILL.md");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nSkill body.\n`);
}

// A no-op reload keeps the system prompt byte-identical so Anthropic prompt
// caching keeps hitting; a real roster change rebuilds the prompt exactly once.
// The gate is applyReloadedSkills returning false on an unchanged skill set —
// refresh() only calls refreshBaseSystemPrompt when the roster actually changed.
describe("AgentSession refresh prompt-cache guard", () => {
	let tempHome: string;
	let cwd: string;
	let originalAgentDir: string;
	const sessions: AgentSession[] = [];
	// The rebuildSystemPrompt spy stands in for the SDK prompt builder; its call
	// count is the observable proxy for a system-prompt rebuild.
	const rebuildSystemPrompt = vi.fn(async (toolNames: string[], _tools: Map<string, unknown>) => ({
		systemPrompt: toolNames,
	}));

	beforeEach(() => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "omp-roster-promptcache-home-"));
		cwd = path.join(tempHome, "project");
		fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
		spyOn(os, "homedir").mockReturnValue(tempHome);
		originalAgentDir = process.env.PI_CODING_AGENT_DIR ?? "";
		setAgentDir(path.join(tempHome, ".omp", "agent"));
		resetCapabilities();
		resetActiveSkillsForTests();
		resetActiveRulesForTests();
		rebuildSystemPrompt.mockClear();
	});

	afterEach(async () => {
		for (const session of sessions.splice(0)) {
			await session.dispose();
		}
		spyOn(os, "homedir").mockRestore();
		if (originalAgentDir) setAgentDir(originalAgentDir);
		resetCapabilities();
		resetActiveSkillsForTests();
		resetActiveRulesForTests();
		fs.rmSync(tempHome, { recursive: true, force: true });
	});

	function createSession(): AgentSession {
		const settings = Settings.isolated({ "compaction.enabled": false });
		const agent = new Agent({
			initialState: { model: createModel(), systemPrompt: ["initial"], tools: [], messages: [] },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(cwd),
			settings,
			modelRegistry: {} as never,
			toolRegistry: new Map(),
			ttsrManager: new TtsrManager(settings.getGroup("ttsr")),
			skillsSettings: settings.getGroup("skills"),
			rebuildSystemPrompt,
		});
		sessions.push(session);
		return session;
	}

	it("does not rebuild the system prompt when the roster did not change", async () => {
		// Session starts with one skill already present; its snapshot matches disk.
		writeSkill(path.join(cwd, ".agents", "skills"), "stable-skill", "Already present.");
		const session = createSession();
		await session.refresh("skills"); // first reload aligns the snapshot to disk
		rebuildSystemPrompt.mockClear();

		// Nothing changed on disk between reloads → no-op.
		const result = await session.refresh("skills");

		expect(result.skills).toBeGreaterThanOrEqual(1);
		expect(rebuildSystemPrompt).not.toHaveBeenCalled();
	});

	it("rebuilds the system prompt exactly once when the advertised skill set changes", async () => {
		const session = createSession();
		await session.refresh("skills"); // align snapshot to the (empty) roster
		rebuildSystemPrompt.mockClear();

		// A brand-new skill appears on disk → the advertised roster changes.
		writeSkill(path.join(cwd, ".agents", "skills"), "fresh-skill", "Newly synced.");

		await session.refresh("skills");

		expect(session.skills.some(s => s.name === "fresh-skill")).toBe(true);
		expect(rebuildSystemPrompt).toHaveBeenCalledTimes(1);
	});
});
