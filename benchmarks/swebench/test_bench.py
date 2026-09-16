import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tarfile
import unittest

spec = importlib.util.spec_from_file_location('bench', Path(__file__).with_name('bench.py'))
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


class BenchmarkContract(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
