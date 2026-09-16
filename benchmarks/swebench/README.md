# Robinhood on SWE-bench Lite

The setup is deliberately separate from inference and grading. **Preparation does not call models, attempt benchmark issues, or run the evaluator.** Both execution commands require an explicit `-Start` flag.

## Prepared protocol

| Setting | Value |
| --- | --- |
| Dataset | `princeton-nlp/SWE-bench_Lite`, test split, 300 tasks |
| Dataset revision | `6ec7bb89b9342f664a54a6e0a6ea6501d3437cc2` |
| Official harness | 3.0.17, commit `3f01bd622c0a22c00406139f69a234ef08225f22` |
| Pilot | 10 tasks selected by a fixed hash ordering, not by results |
| Full profile | All 300 tasks |
| Parallel tasks | 1 |
| Task budget | 100 successful model steps; 30 minutes of agent execution |
| Container limit | 4 GiB RAM, 2 CPUs, 512 processes |
| Attempts | One per task; model fallbacks belong to that attempt |
| Default providers | Anonymous Kilo API, OpenCode CLI, Kilo CLI |

The default uses anonymous free routes. It does not copy Windows credentials or enable account-dependent paid models. Available models are discovered when each task starts and recorded in its trace; this tests Robinhood's adaptive chain, not a frozen single-model system. Shared upstream quotas are not additive. Free capacity has not been probed during setup.

## This Windows checkout

Requires Docker Desktop with its Linux engine and Ubuntu WSL integration enabled. Setup uses an isolated Python environment in `~/.local/share/robinhood-swebench/venv` inside Ubuntu. No Windows Python packages are changed.

Check readiness without starting work:

```powershell
.\benchmarks\swebench\bench.ps1 -Action doctor
```

**Only after deciding to begin**, start the pilot:

```powershell
.\benchmarks\swebench\bench.ps1 -Action run -Profile pilot -Start
```

The full run is a separate invocation with `-Profile full`. It does not automatically follow the pilot. Instance images are downloaded on demand; setup builds the shared Robinhood runtime, not all 300 task images. Image pulls/builds add time beyond the agent's 30-minute budget.

The runner prints an output directory under `.robinhood/swebench/runs/`. Grade it separately, using that directory's name:

```powershell
.\benchmarks\swebench\bench.ps1 -Action evaluate -RunId RUN_DIRECTORY_NAME -Start
```

Each evaluation gets a unique run ID, avoiding the official harness's cached-result collision. Grading runs the official harness in clean containers, separate from the agent's edited containers. No leaderboard submission happens automatically.

## Rebuilding preparation

From Ubuntu WSL or Linux, with Docker and `uv` installed:

```bash
bash benchmarks/swebench/setup.sh
```

This installs the pinned harness, builds the Node 24.13.1 runtime using `package-lock.json`, downloads the pinned dataset, writes the pilot/full manifests, and checks Docker. It still does not run inference or grading. On Linux, invoke `bench.py` with the prepared environment's Python instead of the PowerShell wrapper.

The manifests pin the built runtime image ID. Rebuild and prepare again after changing Robinhood to benchmark those changes. The Python package inventory is captured in `python-environment.txt`; the Docker image retains the exact runtime dependencies. Source-controlled scripts contain no credentials or benchmark solutions. Dataset files and results remain in ignored local storage.

## Artifacts and isolation

Each task uses the official SWE-bench instance image, checked against its expected Git base commit, with Robinhood's runtime copied in. No host project, home directory, credential vault, evaluator dataset, or Docker socket is mounted into the task container. Only an allowlisted task input is copied in: issue description, repository identity, base commit, and execution settings. Gold patches, grading patches, hints, and grading test lists are excluded.

The agent uses Robinhood's existing tools and memory with YOLO enabled. `web_fetch` and `ask_user` are removed for this unattended protocol. Outbound network access remains available for inference, and shell networking is not technically blocked; the prompt forbids looking up published solutions. This is a network-enabled run, not a claim of enforced offline evaluation.

The controller saves:

- `predictions.jsonl`: official `instance_id`, `model_name_or_path`, and `model_patch` fields; includes empty patches for failed attempts.
- Per-task `patch.diff`, `result.json`, `trace.json`, and SQLite receipts when produced.
- Container exit status, bounded console logs, and infrastructure/artifact errors separately.
- Runtime and task image IDs, upstream image digests, dataset checksums, and execution settings.

Patch export includes untracked new files and deletions using a separate Git index. A final assistant response means the attempt ended; **only the official evaluator can label it resolved**. Report resolved/selected tasks and infrastructure failures separately. Token usage is provider-reported where available, not an account balance or guaranteed complete cost measure.

Task containers and derived images are removed after artifacts are collected. Official downloaded images remain cached. The runner stops before another task when less than 20 GiB remains on the checkout filesystem; Docker's virtual-disk capacity must also be sufficient. There is no automatic broad Docker cleanup. A full 300-task run may require more storage than the pilot. Interrupted runs retain their artifacts; automatic mid-run resume is not implemented.

## Validation without inference

```bash
python benchmarks/swebench/test_bench.py
npm run check
```

Tests cover exclusion of solution data, deterministic pilot selection, explicit start guards, and new/deleted file patch export. Runtime smoke checks use `--network none` and do not call a provider.

References: [official evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/), [Docker setup](https://www.swebench.com/SWE-bench/guides/docker_setup/), [dataset](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite).
