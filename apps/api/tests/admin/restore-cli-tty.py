"""Drive the offline CLI using synthetic fixtures only; never print transcripts."""
import os
import pty
import resource
import select
import subprocess
import sys
import time

child = None
try:
    master, slave = pty.openpty()
    env = dict(os.environ)
    for key in ['SSH_CONNECTION', 'NODE_OPTIONS', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_V8_COVERAGE']:
        env.pop(key, None)
    def limits():
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    child = subprocess.Popen(['node', sys.argv[1], sys.argv[2], '--confirm-owned-offline-restore'],
                             stdin=slave, stdout=slave, stderr=slave, env=env, preexec_fn=limits, close_fds=True)
    captured = b''
    offset = 0
    for answer in [b'SyntheticIndependentBackupSecret123', b'RESTORE OFFLINE STAGING COPY']:
        end = time.monotonic() + 10
        while b': ' not in captured[offset:]:
            if time.monotonic() > end:
                raise RuntimeError()
            if select.select([master], [], [], .1)[0]:
                captured += os.read(master, 4096)
        offset = len(captured)
        os.write(master, answer + b'\r')
    end = time.monotonic() + 60
    while child.poll() is None:
        if time.monotonic() > end:
            raise RuntimeError()
        if select.select([master], [], [], .1)[0]:
            captured += os.read(master, 4096)
    while select.select([master], [], [], .02)[0]:
        captured += os.read(master, 4096)
    if child.returncode or b'ADMIN_OFFLINE_RESTORE_REHEARSAL_PASSED' not in captured or b'SyntheticIndependentBackupSecret123' in captured:
        raise RuntimeError()
    os.close(master)
    os.close(slave)
except BaseException:
    if child is not None and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=40)
        except subprocess.TimeoutExpired:
            child.kill()
    print('ADMIN_TEST_OFFLINE_RESTORE_CLI_FAILED', file=sys.stderr)
    sys.exit(1)
