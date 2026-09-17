import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tarfile
import unittest
from unittest.mock import Mock, patch
import json
import tempfile

spec = importlib.util.spec_from_file_location('bench', Path(__file__).with_name('bench.py'))
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


class BenchmarkContract(unittest.TestCase):
    def test_failed_readiness_replaces_stale_ready_report(self):
        with tempfile.TemporaryDirectory() as root, patch.object(bench, 'STATE', Path(root)), patch.object(bench, 'client', side_effect=RuntimeError('Docker unavailable')):
            bench.save(Path(root) / 'readiness.json', {'ready': True})
            with self.assertRaisesRegex(RuntimeError, 'WSL integration'):
                bench.doctor()
            status = json.loads((Path(root) / 'readiness.json').read_text())
            self.assertFalse(status['ready'])
            self.assertFalse(status['benchmark_started'])

    def test_agent_input_excludes_solution_and_grading_data(self):
        row = dict(instance_id='a__b-1', repo='a/b', base_commit='a' * 40, problem_statement='Fix this',
                   patch='SECRET_GOLD', test_patch='SECRET_TEST', hints_text='SECRET_HINT', FAIL_TO_PASS=['SECRET_TEST_NAME'])
        public = bench.public_task(row)
        self.assertEqual(set(public), {'instance_id', 'repo', 'base_commit', 'problem_statement'})
        with tarfile.open(fileobj=io.BytesIO(bench.task_archive(public))) as archive:
            self.assertEqual(archive.getnames(), ['rh-task.json'])
            self.assertNotIn(b'SECRET_', archive.extractfile('rh-task.json').read())

    def test_pilot_is_fixed_and_order_independent(self):
        rows = [dict(instance_id=f'fixture-{i}') for i in range(300)]
        self.assertEqual(bench.pilot_ids(rows), bench.pilot_ids(list(reversed(rows))))
        self.assertEqual(len(set(bench.pilot_ids(rows))), 10)

    def test_run_and_evaluation_require_explicit_start_before_any_imports_or_docker(self):
        for action in ['run', 'evaluate']:
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('bench.py')), action], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn('Nothing started', result.stderr)

    def test_artifact_copy_rejects_paths_and_symlinks_outside_allowlist(self):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as archive:
            for name in ['rh-output/patch.diff', '../escaped.txt', 'rh-output/../escaped.txt']:
                item = tarfile.TarInfo(name)
                item.size = 5
                archive.addfile(item, io.BytesIO(b'patch'))
            link = tarfile.TarInfo('rh-output/result.json')
            link.type = tarfile.SYMTYPE
            link.linkname = '/etc/passwd'
            archive.addfile(link)
        container = Mock()
        container.get_archive.return_value = ([stream.getvalue()], {})
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / 'artifacts'
            destination.mkdir()
            bench.copy_outputs(container, destination)
            self.assertEqual([file.name for file in destination.iterdir()], ['patch.diff'])
            self.assertFalse((Path(root) / 'escaped.txt').exists())

    def test_derived_image_uses_pinned_sources_and_copies_no_dataset(self):
        engine = Mock()
        engine.images.build.return_value = (Mock(), [])
        base = Mock()
        base.attrs = {'RepoDigests': ['swebench/fixture@sha256:abc']}
        bench.build_task_image(engine, {'runtime_reference': 'robinhood-runtime:pinned'}, base, 'fixture')
        dockerfile = engine.images.build.call_args.kwargs['fileobj'].getvalue().decode()
        self.assertIn('FROM swebench/fixture@sha256:abc', dockerfile)
        self.assertNotIn('evaluation-data', dockerfile)
        self.assertNotIn('COPY . ', dockerfile)


if __name__ == '__main__':
    unittest.main()
