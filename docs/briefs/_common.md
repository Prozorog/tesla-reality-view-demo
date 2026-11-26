# Rules for every task in this project (read first)

- **Project folder:** `.`. Never write outside it. The path has spaces: quote every path.
- **Product spec (read-only):** `../ref\PROMPT-tesla-reality-view-phase1-parking.md`. Read the sections your brief names.
- **Contracts and look:** `docs/DESIGN.md`. Names, axes and file formats there are binding.
- **Reference images (read-only, look only):** `../ref\`. Never copy them into `public/` or the build.
- **Other agents are working in this same folder right now on other files.** Touch only the files your brief says you own.
  If you need a change in someone else's file, write it down in your report instead of making it.
- **Git:** do not run `git add`, `git commit`, `git tag`, `git stash`, `git checkout` or `git reset`. The orchestrator commits. Read-only git commands are fine.
- **Do not spawn subagents — do all the work yourself in this thread.**
- **Do not ask questions and do not stop to wait.** Decide unclear points by "closer to the reference, nicer to play with" and log each decision in your report file.
- **Machine rules** (shared PC, 16 GB RAM, several agents at once):
  - every Blender run, build, typecheck, browser run and check goes through the queue: `heavy <command>` (cmd.exe syntax, no `VAR=1 cmd`; default timeout 30 min, `heavy --timeout 60 <command>` to extend). "queue: ... waiting" means waiting, not stuck;
  - servers only through `own-start <command with {port}>` (temporary) — never `&`, `start`, `Start-Process`, `nohup`; if the port already answers, reuse it;
  - run `own-cleanup` before you report done;
  - never kill processes by name or by port, never touch a process you did not start;
  - no watch modes, at most 4 workers.
- **Blender is headless only**, never open its window:
  `heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\<name>.py`
  This is Blender 5.2: check names against the bundled Python API (`dir()`, `bl_rna.properties`) before assuming 3.x / 4.x names
  (bake settings, Principled BSDF sockets, glTF export options, EEVEE engine id). Every script is rerunnable, seeded, and prints triangle counts and output paths.
  Cycles uses the RTX 4070 through OptiX.
- **Files:** UTF-8 without a BOM.
- **Screenshots / renders you save for review:** JPEG quality ~70, at most 1600 px wide. Open at most 2–3 of them yourself per round, only to check nothing is blank or broken and to do the comparison your brief asks for. Do not keep re-opening images: every opened image stays in your context and slows you down.
- **Report:** write `docs/report/<task-id>.md`: changed files; commands run with pass/fail and key numbers (triangle counts, timings); paths of renders / screenshots; decisions made; a plain list of what is unsure, skipped or weaker than the reference, worst first. Your final message is a short version of the same.
- **Clip frames:** one frame per second of both reference clips is in `../ref\` as `park-a-01.jpg … park-a-20.jpg` (overhead reversing view, the key look) and `park-b-01.jpg … park-b-22.jpg` (cruise view with chevrons, tap, parked overhead). Open only the two or three you need.
