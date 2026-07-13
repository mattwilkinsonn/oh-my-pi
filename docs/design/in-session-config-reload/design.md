# In-Session Config Reload (skills · rules · settings/default-model · extensions)

Status: **DESIGN COMPLETE + design-critic pass folded (2026-07-13) — self-grounded against
fork tip v16.4.8. The critic pass CHANGED the record: it corrected two false self-heal claims
(F1 skills don't heal via the global swap; F2 the prompt-cache guard excludes skills/rules)
and materially re-framed the Q1 shape fork (the A+B hybrid is now a live contender, not a
rejected alternative). Two load-bearing forks parked for Matt: Q1 shape, Q2 v1-scope.**
Authored by the OMP owner directly after two `design`-subagent runs yielded on the bare
skeleton (the design skill's documented premature-yield wedge). Every external-code claim
carries file:line + a quoted snippet read this session against `mattwilkinsonn/oh-my-pi`
`main` @ `01d3fc9b6` ("chore: bump version to 16.4.8"), per `rule://planning-evidence`.

This record lives in-repo at `docs/design/in-session-config-reload/design.md` per
`skill://design` (design records are committed under `docs/design/<slug>/` and reviewed on
their own PR — sibling precedent `docs/design/comms-bus-delivery/design.md`). It ships as a
design-only PR against fork `main` (Matt-mergeable; the merge freezes the contract), reviewed
by Matt + the AI bots before any implementation exists. The *implementation* later ships as a
separate fork→upstream code PR (T10) + an upstream proposal issue — vouch-gated (Matt), OUT OF
SCOPE for this record.

Overnight-mode note (2026-07-12 → 07-13 AM): Matt is asleep and cannot rule on the forks, so
per the `rule://decision-authority` overnight carve-out this record is designed against a
**stated assumption** — Shape A (explicit `reload`), extensions **staged** to a later phase —
and the genuine forks are parked in Open Questions for Matt's direct morning ruling, never
decided-by-proxy. The design-critic pass (folded 07-13) then showed A's skills path is more
work than assumed (F1) and raised the A+B hybrid as the stronger roster option; I kept
designing the A mechanism correctly (T2/T8 cover it) so EITHER Q1 ruling is ready to execute,
and I did NOT flip the build by proxy — Q1 now carries the updated recommendation for Matt.

## Problem / Intent

Everything the harness reads once at session-start is frozen for that session's life:
config.yml settings, the resolved default model id, the skill roster, the rule roster, and
the extension registry. A mid-wave change to any of them is invisible to already-running
sessions until a full restart. On a 40+-session wave, picking up one on-disk change (a nix
sync of a new skill; an edit to the default model in config.yml) means restarting the whole
fleet — the anti-pattern this feature removes.

Two REAL motivating cases this session:

1. **Skill/rule roster staleness** (the original ask). A mid-wave-merged skill is
   dead-by-`skill://` in every session that started before the merge. Confirmed live on
   this box: `read skill://review-swarm` → `Unknown skill` while
   `~/.agents/skills/review-swarm/SKILL.md` exists on disk. This bit the review-swarm
   mandate rollout (#618) — mercator had to broadcast the on-disk-path workaround
   (`~/.agents/skills/review-swarm/SKILL.md` instead of `skill://review-swarm`) fleet-wide
   because running sessions' rosters were stale. Same class hit design-critic and
   decision-authority earlier. 3+ instances.
2. **Settings / default-model staleness** (the generalization). Matt wanted to switch the
   fleet's default model by editing the OMP settings file and having every agent re-fetch
   the new default model id, rather than running `/model` on 40+ sessions by hand. That
   specific switch is moot (staying on Claude), but it is the exact scenario proving the
   need: a config-file change should be re-fetchable in-session without a restart.

The skill-roster case is just the first instance of the general problem, so this designs a
GENERAL in-session config-reload primitive with skills/rules as the first concrete
consumer, settings/default-model as the second, and extensions as the third.

### The load-bearing constraint — the `/model` reformat footgun

Matt hit this live: running `/model` reformats the entire config.yml, because a model pick
round-trips through the settings WRITE path. The reload feature MUST be a pure re-READ that
swaps fresh values into the live session with NO write-back and NO reformat side-effect.

Grounded: the write path is what reformats. `settings.ts:2,8`:

```
2: * Settings singleton with sync get/set and background persistence.
8: *   settings.set("theme.dark", "titanium");               // sync write, saves in background
```

`set()` calls `#queueSave()` (`settings.ts:390`), and `#saveNow()` (`:1337`) re-serializes
config.yml. So any reload that touches `set()`/`override()`/`unset()` (each ends in
`#rebuildMerged()` + a possible `#queueSave`) risks the reformat. The reload must reload the
layer state and rebuild the merged view WITHOUT entering the save chain — see Approach.

## Approach

**Recommended shape (post-critic): A for settings/model, and A-or-A+B-hybrid for the roster
— Matt's Q1 fork.** A is one explicit `reload` capability, a pure re-read that re-scans each
frozen surface and swaps the fresh value into the live session, mirroring the existing
mid-session re-scan primitive `refreshMCPTools` (`agent-session.ts:6767`). Scoped
(`reload skills` / `reload rules` / `reload settings` / `reload all`) so an agent that hit
`Unknown skill` self-heals with the narrowest blast radius.

For **settings/model, A is the only viable shape** — there is no "miss" event for a stale
default model or setting, so a lazy re-scan (B) cannot cover it and a watcher (C) pays a
standing cost for a surprising mid-turn swap (full rationale in `## Alternatives considered`).

For the **roster (skills/rules), the critic pass (F1) changed the calculus.** The assumption
this record was designed against was pure-A with a B-flavored error-text hint. But F1 showed
the actual `skill://` read binds a frozen per-session snapshot, so pure-A's skills path is
NOT a free global swap — it must mutate that snapshot on the top-level session and every
running subagent (T2). A true lazy re-scan on miss (B) heals the roster case structurally at
the resolve site regardless of which snapshot is bound, so the **A+B hybrid (A for
settings/model + B for the roster) is now a live contender against pure-A**. This is Matt's
Q1 fork; I designed the A mechanism (T2/T8) correctly so either ruling executes, and did not
decide it by proxy. The `Unknown skill`/`Unknown rule` error text names `reload` regardless.

The design splits cleanly by surface, easiest first:

### Surface 1 — skills + rules (the original ask; cheapest)

The roster lives in two process-globals set once at top-level session load. `skills.ts:44`:

```
44: let activeSkills: readonly Skill[] = [];
```

`skills.ts:50-57`:

```
50: export function getActiveSkills(): readonly Skill[] {
51: 	return activeSkills;
55: export function setActiveSkills(value: readonly Skill[]): void {
56: 	activeSkills = value;
```

Rules are identical — `rule.ts:229`:

```
229: let activeRules: readonly Rule[] = [];
```

`rule.ts:235-242`:

```
235: export function getActiveRules(): readonly Rule[] {
236: 	return activeRules;
240: export function setActiveRules(value: readonly Rule[]): void {
241: 	activeRules = value;
```

Both globals are populated ONCE, top-level only — `sdk.ts:1675-1681`:

```
1675: 		if (!options.parentTaskPrefix) {
1676: 			setActiveSkills(skills);
1681: 			setActiveRules([...rulebookRules, ...alwaysApplyRules, ...ttsrManager.getRules()]);
```

**Reload = re-run discovery, then re-`setActiveSkills`/`setActiveRules`.** Discovery is
`discoverSkills` (`sdk.ts:754`, invoked at `:1199` via `logger.time("discoverSkills", …)`)
feeding `loadSkills` (`skills.ts:123`); rules come from `loadCapability`/`ruleCapability` +
`ttsrManager.getRules()`. A `reloadSkillsAndRules()` re-runs exactly that pipeline and swaps
the two globals — a pointer swap, no session teardown.

`rule://` resolution reads the global directly, so a `setActiveRules` swap self-heals a rule
miss with zero further work. `rule-protocol.ts:15` (no `context` override):

```
15: 		const rules = getActiveRules();
```

**Skills are NOT symmetric — the global swap does not reach the actual `skill://` read**
(critic F1, verified). `skill-protocol.ts:46` is `const skills = context?.skills ??
getActiveSkills()`, and the read tool ALWAYS supplies `context.skills`: `#handleInternalUrl`
calls `internalRouter.resolve(url, { …, skills: this.session.skills })` (`read.ts:3152-3159`)
for every `skill://` read. So the `?? getActiveSkills()` fallback is dead on that path — the
resolve reads the frozen per-session snapshot `this.session.skills`, which is set ONCE in the
ctor (`agent-session.ts:2118 this.#skills = config.skills ?? []`), exposed read-only via
`get skills()` (`:8654`), with NO setter (grep for `#skills =` returns only the ctor line). A
top-level `setActiveSkills` swap therefore does nothing for `read skill://<new>` — the
headline `Unknown skill` case. `getActiveSkills()` is consulted only by the name-claim check
and the completion path, not the tool read.

```
46: 		const skills = context?.skills ?? getActiveSkills();   // context.skills always set by the read tool
57: 			throw new Error(`Unknown skill: ${skillName}\nAvailable: ${availableStr}`);
```

**So skills reload needs two swaps, not one:** re-`setActiveSkills` (the global, for the
name-claim/completion consumers) AND mutate the live per-session snapshot via a new
`AgentSession.applyReloadedSkills(skills)` that reassigns `#skills` on the top-level session
and each running subagent (subagents read the same `this.session.skills` snapshot, so they
have the identical staleness — there is no free subagent inheritance for skills). This is T2.
Rules need only the global swap. Reload runs on the top-level session and fans the snapshot
mutation out to children; exact routing is a task detail, not a fork.

### Surface 2 — settings + default model (a pure-re-read precedent already exists)

The key find: `settings.ts` already ships a pure-re-read method that does NOT save —
`reloadForCwd` (`settings.ts:485-496`):

```
485: 	async reloadForCwd(cwd: string): Promise<void> {
487: 		if (normalized === this.#cwd) return;
490: 		if (this.#persist) {
491: 			this.#project = await this.#loadProjectSettings();
493: 		this.#rebuildMerged();
494: 		this.#fireEffectiveSettingChanged("modelRoles", this.get("modelRoles"), prevModelRoles);
495: 		this.#fireAllHooks();
```

It re-reads a layer, rebuilds the merged view, and fires the change signals + side-effect
hooks — **with no `#queueSave`**. That is exactly the shape the general reload needs. Its
gaps: (a) it early-returns when cwd is unchanged (`:487`) — the in-place case we want; and
(b) it reloads only the PROJECT layer, not the GLOBAL layer where the default model lives.

Even better, that exact all-layer no-save re-read ALREADY exists — `#loadReadOnly()`
(`settings.ts:718-730`, critic F3): it runs `#loadExistingMainYaml` (global) +
`#loadProjectSettings` (project) + `#loadConfigOverlays` (overlays) → `#rebuildMerged()`, with
NO save, NO `#load`, NO migration. The only gap vs `reloadForCwd` is the signal firing. The
path to avoid is `#load` (`:688-716`) — it opens storage and may run the JSON→YAML migration,
which WRITES config.yml:

```
718: 	async #loadReadOnly(): Promise<Settings> {   // no save, no #load, no migration
728: 		this.#rebuildMerged();
```

So `Settings.reload()` = `await #loadReadOnly()` + `#fireEffectiveSettingChanged("modelRoles",
…)` + `#fireAllHooks()` — reusing the existing re-read instead of reinventing it. It never
calls `set()`/`override()`/`#queueSave()`, so config.yml is never rewritten — the footgun is
avoided by construction.

**Default-model swap.** The session's active model derives from the settings
`defaultProvider`/`defaultModelId` at init — model-resolver init `:1646`:

```
1646: 	if (defaultProvider && defaultModelId) {
1647: 		const found = modelRegistry.find(defaultProvider, defaultModelId);
```

On a settings reload, re-resolve via `resolveModelFromSettings` (`model-resolver.ts:1146`)
and swap the session's active model IF it changed — but only when the user has NOT set a
session-only `/model` override (a settings reload must not clobber an explicit in-session
pick). `modelRolesSignal` (`settings.ts:1522`, exposed as `onModelRolesChanged` `:1525`)
already fans out role changes, so the reload's `#fireEffectiveSettingChanged("modelRoles", …)`
(as in `reloadForCwd:494`) drives the role-dependent consumers for free.

### Surface 3 — extensions (hardest; recommend staging to a later phase)

Extensions are NOT a pointer-swap. `extensions/loader.ts:490-494` (doc on
`preloadedExtensionPaths`):

```
490:  * Subagents reuse the parent's collected paths via the SDK's
491:  * `preloadedExtensionPaths` option, then call {@link loadExtensions} themselves
492:  * so each session rebuilds Extension instances bound to its OWN
493:  * `ExtensionAPI` (cwd, eventBus, runtime). Forwarding the parent's
494:  * `LoadExtensionsResult` directly would reuse handlers/tools/commands …
```

`loadExtensions` (`loader.ts:335`) binds handlers, tools, slash-commands, and an `EventBus`
per session (`loader.ts:490-495`). Live tool re-registration itself is NOT the blocker —
three precedents exist: `refreshMCPTools` (`agent-session.ts:6767`, teardown+rebind of
`#toolRegistry`) and `activateVibeTools`/`deactivateVibeTools` (`:6170`/`:6187`). The real
gate (critic F5) is tearing down and rebinding the per-session event-bus subscriptions and
hooks without leaking or double-firing — materially harder and riskier than the skills/rules
snapshot mutation or the settings re-read, and needed by neither motivating case.
**Recommend v1 = skills + rules + settings/default-model; extensions staged to a documented
Phase 2** (Q2 is Matt's scope fork).

### Prompt-cache stability (the guard is a model, not a drop-in — critic F2)

`skill://`/`rule://` resolution reads live state and needs no prompt rebuild. But the
skill/rule *advertisement* renders into the system prompt, and re-rendering busts Anthropic
prompt caching for the rest of the session. Two verified facts (critic F2) mean we cannot
just call the existing guard:

1. **The advertisement renders from CLOSURE-CAPTURED locals, not the globals.**
   `rebuildSystemPrompt` (`sdk.ts:2358`) passes the lexically-bound `skills`/`rulebookRules`
   (`sdk.ts:2433`,`:2437`) — the same locals fed to `setActiveSkills` at init — into
   `buildSystemPromptInternal`. So re-invoking `refreshBaseSystemPrompt`
   (`agent-session.ts:6621`) as-is re-renders the STALE roster; the fresh roster must be
   threaded into that rebuild path (T8a).
2. **The tool signature guard EXCLUDES skills/rules.** `#computeAppliedToolSignature`
   (`agent-session.ts:6685-6713`) enumerates its inputs — tool names/labels/descriptions/
   wire-names + MCP instructions — and skills/rules are not among them, so it cannot detect a
   roster change. Reload needs its own rendered-roster hash to gate the rebuild (T8b).

The guard's byte-identical-skip discipline (`:6533-6535`) is still the model: rebuild once on
a real roster change, skip when the roster hash is unchanged, so a no-op reload keeps prompt
caching hitting.

## Alternatives considered

### B — lazy re-scan on `skill://` / `rule://` miss (NOT rejected post-critic; the hybrid's roster half — see Q1)

On a roster miss, re-run discovery once and retry before throwing `Unknown`. Transparent for
the roster case and fixes every caller with zero agent action.

The critic pass (F4) raised B's standing. Because the actual `skill://` read binds the frozen
`this.session.skills` snapshot (F1), B's re-scan-and-retry INSIDE the resolve path heals the
roster miss structurally at the miss site — it does not depend on which snapshot the read
binds, so it sidesteps the snapshot-fanout that pure-A needs (T2). B still cannot cover
Surface 2 at all: there is no "miss" event for a stale default model or setting — the value
resolves to the old one silently. So B is not a general answer on its own, but as the ROSTER
half of an A+B hybrid (A for settings/model, B for skills/rules) it is now a live Q1 option,
not a mere error-text hint. Cost to weigh: a re-scan mutates state as a side-effect of a
resolver read, and fires a `loadSkills` re-scan on a genuinely typo'd `skill://` (bounded by
scanning once per miss). Its cheapest sub-form — naming `reload` in the `Unknown skill`/
`Unknown rule` error text (`skill-protocol.ts:57`) — stays in pure-A regardless.

### C — fs-watch on config + skills/rules dirs (rejected)

A watcher re-runs the relevant reload on file change. Always-fresh, no agent action.

Rejected: heaviest option — a persistent watcher in each of 40+ sessions, firing on
nix-switch write storms (needs debounce), across multiple directories, with cross-platform
fs-watch reliability caveats. Worse, an automatic swap of the live model/settings mid-turn
is a surprising, hard-to-reason side-effect (a wave agent's model changing under it
mid-task). The triggering events fire a few times per wave — not worth a standing watcher.
Explicit `reload` gives the same freshness on demand with none of the standing cost.

### D — full session restart / re-`newSession` (rejected)

Rebuild the session from scratch to pick up config. Rejected: throws away conversation
context and in-flight work — exactly the 40-session-restart pain this feature removes.

## Global Constraints

Every task inherits these.

- **Fork boundary.** This design record ships in-repo as a design-only PR against fork `main`.
  The *implementation* targets the fork `mattwilkinsonn/oh-my-pi` → upstream
  `can1357/oh-my-pi`; upstream open is vouch-gated (Matt). Do NOT commit implementation to the
  compaction lane branch `omp-idle-autocontinue` — reload is its own branch (`omp-config-reload`).
- **Pure re-READ, no write-back.** The reload path must never call
  `set()`/`override()`/`unset()`/`#queueSave()`/`#saveNow()` and must not enter `#load`
  (which can run the config.yml-writing migration). Re-read layers + `#rebuildMerged()` +
  fire signals only — the `reloadForCwd` (`settings.ts:485`) discipline. This is the
  hard `/model`-footgun constraint.
- **Cover `skill://` and `rule://` asymmetrically (critic F1).** `rule://` (`rule-protocol.ts:15`)
  reads only the global, so `setActiveRules` suffices. `skill://` reads the frozen
  `this.session.skills` snapshot (`read.ts:3152-3159`), so skills ALSO need the per-session
  snapshot mutation (T2), not just the `setActiveSkills` global swap.
- **Prompt-cache stability.** A no-op reload must be byte-identical and skip the
  system-prompt rebuild. The existing tool signature guard (`agent-session.ts:6533-6535`) is
  the DISCIPLINE to copy but does NOT cover skills/rules (critic F2), so reload adds its own
  rendered-roster change-detection (T8): a real roster change rebuilds once, a no-op skips.
- **Respect session-only overrides.** A settings reload must not clobber an explicit
  in-session `/model` pick or other runtime `#overrides` (those are the highest-precedence
  merge layer, `settings.ts:1376-1378`).
- **Subagent semantics (corrected per critic F1).** Reload runs on the top-level session, but
  for SKILLS it must fan the snapshot mutation out to running subagents — each reads its OWN
  frozen `this.session.skills`, so there is no free inheritance via the `setActiveSkills`
  global. Rules (`rule-protocol.ts:15`, global-only) and settings need only the top-level
  swap/re-read.
- **Version floor.** Grounded against v16.4.8 (`package.json`; bun 1.3.14). Re-confirm the
  load-bearing cites survive on the fork tip at implementation time (line numbers drift).
- **TS not bash.** No new bash scripts.
- **Red→green tests** (`rule://red-green-testing`), deterministic, no retries
  (`rule://no-retries`); `rule://pre-finish-checks` before done.

## Plan

Sequenced easiest → hardest so each phase ships independently and the original ask (roster)
lands first. Phases 1–3 are v1 under the stated assumption; Phase 4 (extensions) is staged
pending Q2.

### Phase 1 — skills + rules reload (the original ask)
### Phase 2 — settings + default-model reload (pure re-read, footgun-safe)
### Phase 3 — the `reload` tool/action surface + error-text hint
### Phase 4 — extensions (STAGED; gated on Q2)

## Tasks

- **T1 — RED test: skills/rules reload.**
  A newly-added on-disk skill resolves via `skill://` AFTER a reload but not before; same for
  a `rule://` rule. Drive `reloadSkillsAndRules()` directly over a temp skills/rules dir:
  assert `skill://<new>` throws `Unknown skill` before, resolves after; assert the process
  never writes any config file. Deterministic (temp dir + direct call, no fs-watch, no
  timers).
  `Interfaces:` `reloadSkillsAndRules(opts?: { cwd?: string }): Promise<{ skills: number; rules: number }>` (exported from `extensibility/skills.ts` or a new `extensibility/reload.ts`); consumes `discoverSkills`/`loadSkills` + `ruleCapability`/`ttsrManager.getRules()`; produces fresh `setActiveSkills`/`setActiveRules` swaps.

- **T2 — Implement skills/rules reload.**
  Re-run the `sdk.ts:1199` discovery pipeline + rule bucketing, then: (a) `setActiveRules`
  (`rule.ts:240`) — pointer swap heals `rule://`; (b) `setActiveSkills` (`skills.ts:55`) for
  the global AND a new `AgentSession.applyReloadedSkills(skills)` that re-threads the fresh
  snapshot into `#skills` (which has no setter today, `agent-session.ts:2118`/`:8654`) on the
  top-level session and every running subagent — without this, `read skill://<new>` still
  throws (critic F1). No event-bus/tool teardown.
  `Interfaces:` as T1; internal — reuse `discoverSkills(cwd, agentDir, skillsSettings)` (`sdk.ts:754`) and `bucketRules` (`sdk.ts:31` import); add `applyReloadedSkills` to `AgentSession`.

- **T3 — RED test: settings reload is footgun-safe.**
  A changed `defaultModelId` (or any setting) in config.yml is picked up by `Settings.reload()`
  AND the config.yml file bytes are unchanged (no reformat). Write a config.yml with known
  formatting/comments, mutate one value on disk, `reload()`, assert `get()` returns the new
  value AND the file bytes are byte-identical to what was written (reload never saved).
  Assert `#queueSave`/`#saveNow` are not invoked (spy or a persisted-instance no-write
  assertion).
  `Interfaces:` `Settings.reload(): Promise<void>` (re-reads `#global`/`#project`/`#configOverlay`, `#rebuildMerged()`, fires `#fireEffectiveSettingChanged` + `#fireAllHooks()`; no save; does NOT call `#load`).

- **T4 — Implement `Settings.reload()`.**
  Reuse the existing all-layer no-write re-read `#loadReadOnly()` (`settings.ts:718-730`,
  critic F3) and add the signal firing it omits: `Settings.reload()` = `await #loadReadOnly()`
  + `#fireEffectiveSettingChanged("modelRoles", …)` + `#fireAllHooks()`. `#loadReadOnly`
  already avoids `#load`/migration/save, so the footgun is avoided by construction. Do NOT
  reinvent the layer re-reads.
  `Interfaces:` as T3.

- **T5 — RED test: default-model swap on settings reload, override-respecting.**
  With no session `/model` override, a changed `defaultModelId` in config.yml swaps the
  session's active model after `reload()`; WITH a session-only override set, reload does NOT
  change the active model. Deterministic (isolated Settings + a stub model registry).
  `Interfaces:` a session hook that, on the settings reload, re-resolves via `resolveModelFromSettings` (`model-resolver.ts:1146`) and swaps the active model iff changed and no runtime override is present.

- **T6 — Implement default-model swap.**
  Subscribe the session to the settings reload (reuse `onModelRolesChanged`,
  `settings.ts:1525`, plus a settings-reloaded signal) → re-resolve default model → swap iff
  changed and not session-overridden. Then reconcile prompt state via T8's guard.
  `Interfaces:` as T5.

- **T7 — RED test: prompt-cache stability.**
  A no-op reload (nothing changed on disk) does NOT rebuild the system prompt (signature
  unchanged); a reload that changes the advertised skill set DOES rebuild exactly once.
  Assert against `#lastAppliedToolSignature` / a rebuild spy.
  `Interfaces:` reload calls into the existing signature-guarded rebuild (`agent-session.ts:6533-6539` / `refreshBaseSystemPrompt` `:6621`).

- **T8 — Implement prompt-rebuild reconciliation (extended per critic F2).**
  Two parts, because mirroring the tool signature is not enough: (a) thread the FRESH
  skills/rules into the rebuild — the advertisement renders from closure-captured locals
  (`sdk.ts:2433`,`:2437`), so re-invoking `refreshBaseSystemPrompt` as-is re-renders the
  stale roster; (b) extend change-detection with a rendered-roster hash — the tool signature
  (`agent-session.ts:6685-6713`) excludes skills/rules, so it can't gate this. Rebuild once
  on a real roster change; skip when the roster hash is unchanged (cache preserved).
  `Interfaces:` as T7, plus a fresh-roster parameter into the base-prompt rebuild path.

- **T9 — The `reload` tool/action + error-text hint.**
  Add a scoped `reload` action (`skills`|`rules`|`settings`|`all`) that calls the T2/T4/T6
  entry points on the top-level session; a subagent invocation routes to the top-level
  global (no-op locally). Decide tool-vs-`manage-skill`-action at implementation:
  `manage-skill.ts:15` today is `action: "'create' | 'update' | 'delete'"` — a `reload`
  belongs to a broader config surface than skill authoring, so a dedicated `reload` tool (or
  a `/reload` command mirroring `/mcp reload`) is the cleaner home; confirm at impl. Amend
  the `Unknown skill`/`Unknown rule` error text (`skill-protocol.ts:57`) to name `reload`.
  `Interfaces:` `reload(scope: "skills" | "rules" | "settings" | "all"): Promise<ReloadResult>`; `ReloadResult = { skills?: number; rules?: number; settingsChanged?: boolean; modelSwapped?: boolean }`.

- **T10 — Fork branch + upstream PR + review loops.**
  Branch `omp-config-reload` off `upstream/main`; PR fork→upstream (vouch-gated, Matt).
  Run the mandatory review-swarm (`skill://review-swarm`, on-disk path if `skill://` stale)
  + the SaaS bot loop (`skill://autonomous-review`); surface judgment calls to Matt; hold the
  lane until merge. Squash-merge co-author trailer discipline per `rule://commit-conventions`
  (the `Co-Authored-By: seal …` line must be the LAST line of the PR body).

- **T11 — (STAGED, gated on Q2) extensions reload.**
  Only if Matt scopes extensions into v1. Re-run `discoverAndLoadExtensions`
  (`loader.ts:588`) and rebind the per-session `ExtensionAPI` — tear down live tool/command
  registrations + event-bus subscriptions and re-register. Materially larger; its own RED
  tests for tool re-registration and hook rebinding. Deferred by default.

## Open Questions

- **Q1 — SHAPE (genuine fork for Matt; the critic pass materially changed this).** Options:
  **A** explicit scoped `reload` — covers every frozen surface (it is the ONLY option that
  can cover settings/default-model, which has no "miss" event), mirrors `refreshMCPTools`,
  on-demand. But critic F1 showed A's skills path is not a free global swap: it needs the
  session-snapshot mutation (T2) and the extended prompt rebuild (T8). **A+B hybrid** — A,
  PLUS a lazy re-scan on `skill://`/`rule://` miss. The critic sharpened B's appeal: a
  re-scan-and-retry INSIDE the resolve path heals the roster miss structurally at the miss
  site, independent of which snapshot is read — so it sidesteps F1's snapshot problem for the
  headline `Unknown skill` case, where pure-A must thread the snapshot into every session.
  B still cannot cover settings/model, so the hybrid is A-for-settings + B-for-roster. **C**
  fs-watch (rejected — standing cost + surprising mid-turn swaps). *Updated recommendation:
  the hybrid now looks stronger than pure-A for the roster case given F1; A remains
  unavoidable for settings/model. Parked for Matt — I have NOT flipped the build on this;
  overnight I keep designing the A mechanism correctly (T2/T8) so either ruling is ready.*

- **Q2 — v1 SCOPE (genuine fork for Matt).** Are extensions in v1, or staged to Phase 2?
  Extensions require live re-registration of per-session-bound handlers/tools/commands/event
  bus (`loader.ts:490-494`) — materially harder than the skills/rules pointer-swap and the
  settings re-read, and needed by neither motivating case. *Recommendation: v1 =
  skills + rules + settings/default-model; extensions staged (T11 gated on this).* Designed
  against "staged" as the stated overnight assumption.

- **Q3 — reload tool home (impl detail, not a fork).** Dedicated `reload` tool vs `/reload`
  command vs a `manage-skill` action. Leaning `/reload` command mirroring `/mcp reload` (it
  spans more than skills), resolved at T9 implementation; noted here for visibility, not a
  Matt decision.

## Provenance

- Original ask (skill/rule roster refresh) + generalization to a full in-session config
  reload, both routed by Matt via mercator (supervisor) to the OMP owner; the `/model`
  reformat footgun reported by Matt as the crux.
- Two `design`-subagent runs yielded on the bare skeleton (premature-yield wedge); the OMP
  owner then authored the record directly, holding the full grounding.
- All external-code claims verified this session against `mattwilkinsonn/oh-my-pi` `main`
  @ `01d3fc9b6` (v16.4.8) per `rule://planning-evidence`.
- Ships in-repo as a design-only PR (`docs/design/in-session-config-reload/design.md`) per
  `skill://design`; the implementation later ships as a fork→upstream code PR (T10) + an
  upstream proposal issue.
- Design-critic pass (SEA-1188 adversarial obligation): DONE 2026-07-13, read-only `explore`
  subagent with the critic definition inlined (design-critic isn't directly spawnable).
  5 findings, all verified against the code by the owner before folding:
  - **F1 (HIGH, folded):** `skill://` self-heal via global swap is FALSE — the read tool
    passes the frozen `this.session.skills` snapshot (`read.ts:3152-3159`), which has no
    setter (`agent-session.ts:2118`/`:8654`); rules DO self-heal, skills need a snapshot
    mutation. Corrected Surface 1, T2, Global Constraints; re-framed Q1.
  - **F2 (HIGH, folded):** prompt-cache guard can't just be mirrored — the advertisement
    renders from closure-captured locals (`sdk.ts:2433`,`:2437`) and the signature guard
    (`agent-session.ts:6685-6713`) excludes skills/rules. Corrected the prompt-cache section
    + T8.
  - **F3 (folded):** `#loadReadOnly` (`settings.ts:718-730`) already IS the all-layer no-write
    re-read T4 reinvented. T4 now reuses it.
  - **F4 (folded into Q1):** B (lazy re-scan on miss) heals the roster case structurally at
    the miss site, sidestepping F1 — strengthens the hybrid relative to pure-A.
  - **F5 (folded into Surface 3):** live tool rebind has precedents (`refreshMCPTools`,
    `activateVibeTools`); the real extensions gate is event-bus/hook unsubscribe, not tool
    re-registration.
  - **SURVIVED:** the `/model`-footgun core constraint — every settings loader is write-free
    except `#migrateFromLegacy` (`:854`), reachable only via `#load`, which reload never calls.
