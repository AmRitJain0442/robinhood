"""Offline environment smoke check. Never invokes the agent or task tests."""
import json
import bench

profile = bench.load_profile('pilot')
task_id = profile['instance_ids'][0]
engine = bench.client()
images = json.loads((bench.STATE / 'images.json').read_text())
tasks = {row['instance_id']: row for row in json.loads((bench.STATE / 'tasks.json').read_text())}
base = engine.images.get(images[task_id])  # Pull explicitly before this check.
image = bench.build_task_image(engine, profile, base, 'setup-compatibility', tasks[task_id]['base_commit'])
try:
    script = '''set -eu
node --version
test "$(git rev-parse HEAD)" = "$EXPECTED_BASE"
test -z "$(git status --porcelain)"
python --version
node --input-type=module -e 'import { createRequire } from "node:module"; const r = createRequire("/opt/robinhood/package.json"); const D = r("better-sqlite3"); const db = new D(":memory:"); console.log(db.prepare("SELECT 1 AS ok").get()); db.close(); for (const p of ["opencode-ai", "@kilocode/cli", "node-pty"]) console.log(p, r(p + "/package.json").version);'
'''
    result = engine.containers.run(image.id, command=['bash', '-c', script], network_disabled=True,
                                  environment={'EXPECTED_BASE': tasks[task_id]['base_commit']},
                                  mem_limit='4g', nano_cpus=2_000_000_000, pids_limit=512,
                                  cap_drop=['ALL'], security_opt=['no-new-privileges'], remove=True)
    print(result.decode())
    bench.save(bench.STATE / 'compatibility.json', dict(instance_id=task_id, base_image=base.id,
               runtime_image=profile['runtime_image'], checked=True, model_requests=0, network_enabled=False))
finally:
    engine.images.remove(image.id)
