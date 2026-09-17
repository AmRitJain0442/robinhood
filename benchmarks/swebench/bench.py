"""Preparation never invokes inference or evaluation. Both require --start."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.robinhood' / 'swebench'
DATASET = 'princeton-nlp/SWE-bench_Lite'
REVISION = '6ec7bb89b9342f664a54a6e0a6ea6501d3437cc2'
HARNESS = '3f01bd622c0a22c00406139f69a234ef08225f22'
RUNTIME = 'robinhood-swebench-runtime:prepared'
PROVIDERS = ['kilo', 'opencode', 'kilo-cli']


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def public_task(row):
    # Deliberate allowlist: never pass patch, test_patch, test lists or hints.
    return {key: row[key] for key in ('instance_id', 'repo', 'base_commit', 'problem_statement')}


def pilot_ids(rows):
    return [row['instance_id'] for row in sorted(rows, key=lambda row: hashlib.sha256(('robinhood-lite-pilot-v1:' + row['instance_id']).encode()).hexdigest())[:10]]


def client():
    import docker
    result = docker.from_env(timeout=1800)
    result.ping()
    return result


def prepare():
    from datasets import load_dataset
    STATE.mkdir(parents=True, exist_ok=True)
    rows = [dict(row) for row in load_dataset(DATASET, revision=REVISION, split='test')]
    assert len(rows) == 300 and len({row['instance_id'] for row in rows}) == 300
    runtime = client().images.get(RUNTIME)
    runtime_reference = 'robinhood-swebench-runtime:' + runtime.id.split(':')[1][:16]
    runtime.tag(runtime_reference)
    # This private file belongs only to the controller/evaluator, never a mount.
    save(STATE / 'evaluation-data.json', rows)
    save(STATE / 'tasks.json', [public_task(row) for row in rows])
    # Pinned harness TestSpec.instance_image_key convention. No need to generate
    # evaluation scripts (which fetch repository requirements) during setup.
    images = {row['instance_id']: ('swebench/sweb.eval.x86_64.' + row['instance_id'].lower() + ':latest').replace('__', '_1776_') for row in rows}
    save(STATE / 'images.json', images)
    common = dict(dataset=DATASET, dataset_revision=REVISION, harness_commit=HARNESS,
                  runtime_image=runtime.id, runtime_reference=runtime_reference, tasks_sha256=digest(STATE / 'tasks.json'),
                  evaluation_sha256=digest(STATE / 'evaluation-data.json'), images_sha256=digest(STATE / 'images.json'),
                  providers=PROVIDERS, timeout_seconds=1800, max_model_steps=100,
                  workers=1, memory='4g', cpus=2, attempts_per_task=1)
    for name, ids in [('pilot', pilot_ids(rows)), ('full', sorted(row['instance_id'] for row in rows))]:
        save(STATE / f'{name}.json', dict(common, profile=name, instance_ids=ids))
    freeze = subprocess.run([str(Path.home() / '.local/bin/uv'), 'pip', 'freeze', '--python', sys.executable], check=True, capture_output=True, text=True)
    (STATE / 'python-environment.txt').write_text(freeze.stdout, encoding='utf-8')
    doctor()
    print('PREPARED ONLY: 10 pilot / 300 full tasks. No inference or evaluation started.')


def load_profile(name):
    profile = json.loads((STATE / f'{name}.json').read_text())
    for filename, key in [('tasks.json', 'tasks_sha256'), ('evaluation-data.json', 'evaluation_sha256'), ('images.json', 'images_sha256')]:
        if digest(STATE / filename) != profile[key]:
            raise RuntimeError(f'{filename} changed; prepare a fresh manifest.')
    return profile


def doctor():
    try:
        return check_readiness()
    except Exception as error:
        save(STATE / 'readiness.json', dict(ready=False, checked_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
             benchmark_started=(STATE / 'runs').exists(), error=str(error), model_requests_during_setup=0))
        raise RuntimeError('Readiness check failed. Check Docker Desktop is running with Ubuntu WSL integration enabled; inspect .robinhood/swebench/readiness.json for details.') from error


def check_readiness():
    import importlib.metadata
    engine = client()
    info = engine.info()
    runtime = engine.images.get(RUNTIME)
    profiles = {name: len(load_profile(name)['instance_ids']) for name in ['pilot', 'full'] if (STATE / f'{name}.json').exists()}
    if profiles != {'pilot': 10, 'full': 300}:
        raise RuntimeError('Pilot/full manifests are missing or invalid; run preparation first.')
    status = dict(prepared=True, ready=True, checked_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  benchmark_started=(STATE / 'runs').exists(), docker_os=info['OSType'],
                  docker_memory_gib=round(info['MemTotal'] / 2**30, 1),
                  host_free_gib=round(shutil.disk_usage(ROOT).free / 2**30, 1),
                  swebench=importlib.metadata.version('swebench'), runtime_image=runtime.id,
                  profiles=profiles, model_requests_during_setup=0)
    if info['OSType'] != 'linux':
        raise RuntimeError('Linux Docker containers are required.')
    if status['swebench'] != '3.0.17':
        raise RuntimeError('Wrong harness version; use setup.sh.')
    save(STATE / 'readiness.json', status)
    print(json.dumps(status, indent=2))


def task_archive(task):
    data = json.dumps(task).encode()
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        item = tarfile.TarInfo('rh-task.json')
        item.size = len(data)
        item.mode = 0o444
        archive.addfile(item, io.BytesIO(data))
    return stream.getvalue()


def copy_outputs(container, directory):
    # Extract only bounded regular artifacts; never trust archive paths/symlinks.
    chunks, _ = container.get_archive('/rh-output')
    archive_file = directory / 'output.tar'
    with archive_file.open('wb') as out:
        for chunk in chunks:
            out.write(chunk)
            if out.tell() > 100 * 1024 * 1024:
                raise RuntimeError('Task artifacts exceed 100 MiB.')
    with tarfile.open(archive_file) as archive:
        for item in archive:
            if item.isfile() and item.name in ['rh-output/patch.diff', 'rh-output/result.json', 'rh-output/trace.json', 'rh-output/session.db'] and item.size <= 30 * 1024 * 1024:
                with archive.extractfile(item) as source:
                    (directory / Path(item.name).name).write_bytes(source.read())
    archive_file.unlink()


def build_task_image(engine, profile, base, label):
    dockerfile = f'''FROM {profile['runtime_reference']} AS runtime
FROM {base.attrs['RepoDigests'][0]}
COPY --from=runtime /usr/local /usr/local
COPY --from=runtime /opt/robinhood /opt/robinhood
ENV PATH=/opt/miniconda3/envs/testbed/bin:/opt/miniconda3/bin:/usr/local/bin:/usr/bin:/bin
ENV ROBINHOOD_BENCHMARK=swebench-lite
WORKDIR /testbed
CMD ["node", "/opt/robinhood/dist/src/benchmark-worker.js"]
'''
    image, _ = engine.images.build(fileobj=io.BytesIO(dockerfile.encode()), rm=True, labels={'robinhood.benchmark': label})
    return image


def run(profile_name):
    profile = load_profile(profile_name)
    engine = client()
    if engine.images.get(profile['runtime_reference']).id != profile['runtime_image']:
        raise RuntimeError('Prepared runtime image changed; prepare a fresh manifest.')
    run_id = f"robinhood-lite-{profile_name}-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    output = STATE / 'runs' / run_id
    output.mkdir(parents=True, exist_ok=False)
    save(output / 'manifest.json', dict(profile, run_id=run_id))
    tasks = {row['instance_id']: row for row in json.loads((STATE / 'tasks.json').read_text())}
    images = json.loads((STATE / 'images.json').read_text())
    predictions = []
    for number, instance_id in enumerate(profile['instance_ids'], 1):
        if shutil.disk_usage(ROOT).free < 20 * 2**30:
            raise RuntimeError('Less than 20 GiB free. Stopped before starting another task; existing results retained.')
        print(f'[{number}/{len(profile["instance_ids"])}] {instance_id}', flush=True)
        directory = output / instance_id
        directory.mkdir()
        container = None
        image = None
        started = time.time()
        try:
            base = engine.images.pull(images[instance_id], platform='linux/amd64')
            # Copy only the runtime into the official prepared task environment.
            image = build_task_image(engine, profile, base, run_id)
            save(directory / 'images.json', dict(base=base.id, repo_digests=base.attrs.get('RepoDigests'), runtime=profile['runtime_image'], task=image.id))
            task = dict(tasks[instance_id], timeout_seconds=profile['timeout_seconds'], providers=profile['providers'])
            # Anonymous free providers by default; do not inherit host secrets.
            container = engine.containers.create(image.id, name=f'rh-{uuid.uuid4().hex}', mem_limit=profile['memory'], nano_cpus=int(profile['cpus'] * 1e9), pids_limit=512, cap_drop=['ALL'], security_opt=['no-new-privileges'], labels={'robinhood.benchmark': run_id})
            container.put_archive('/', task_archive(task))
            container.start()
            try:
                result = container.wait(timeout=profile['timeout_seconds'] + 120)
                save(directory / 'exit.json', result)
            except Exception:
                container.stop(timeout=10)
                raise
            finally:
                (directory / 'console.log').write_bytes(container.logs(tail=10000))
                try:
                    copy_outputs(container, directory)
                except Exception as error:
                    save(directory / 'artifact-error.json', {'error': str(error)})
            if not (directory / 'result.json').exists():
                raise RuntimeError('Worker did not produce a result. Inspect console.log.')
        except Exception as error:
            save(directory / 'infrastructure-error.json', {'error': str(error), 'elapsed_seconds': time.time() - started})
        finally:
            if container is not None:
                container.remove(force=True)
            if image is not None:
                engine.images.remove(image.id)
        patch = (directory / 'patch.diff').read_text(encoding='utf-8') if (directory / 'patch.diff').exists() else ''
        predictions.append(dict(instance_id=instance_id, model_name_or_path='robinhood-auto', model_patch=patch))
        temporary = output / 'predictions.jsonl.tmp'
        temporary.write_text(''.join(json.dumps(row) + '\n' for row in predictions), encoding='utf-8')
        temporary.replace(output / 'predictions.jsonl')
    print(f'Inference finished. Predictions: {output / "predictions.jsonl"}. Evaluation is a separate command.')


def evaluate(run_id):
    if not run_id or any(char not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for char in run_id):
        raise ValueError('Supply the run directory name, not a path.')
    directory = STATE / 'runs' / run_id
    manifest = json.loads((directory / 'manifest.json').read_text())
    if digest(STATE / 'evaluation-data.json') != manifest['evaluation_sha256']:
        raise RuntimeError('Evaluation dataset changed.')
    evaluation_id = run_id + '-eval-' + uuid.uuid4().hex[:8]
    subprocess.run([sys.executable, '-m', 'swebench.harness.run_evaluation',
                    '--dataset_name', str(STATE / 'evaluation-data.json'),
                    '--predictions_path', str(directory / 'predictions.jsonl'),
                    '--instance_ids', *manifest['instance_ids'], '--max_workers', '1',
                    '--run_id', evaluation_id, '--timeout', '1800', '--cache_level', 'env',
                    '--report_dir', str(directory)], cwd=directory, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'doctor', 'run', 'evaluate'])
    parser.add_argument('--profile', choices=['pilot', 'full'], default='pilot')
    parser.add_argument('--run-id')
    parser.add_argument('--start', action='store_true', help='Explicitly start inference or evaluation; never needed for preparation.')
    args = parser.parse_args()
    if args.action in ['run', 'evaluate'] and not args.start:
        parser.error('Nothing started. Add --start only when you intend to begin the run.')
    if args.action == 'prepare':
        prepare()
    elif args.action == 'doctor':
        doctor()
    elif args.action == 'run':
        run(args.profile)
    else:
        evaluate(args.run_id)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, FileNotFoundError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
