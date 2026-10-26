"""Real local PTY; print no inputs or child transcripts, even on assertion failure."""
import hashlib
import json
import os
import pty
import secrets
import select
import subprocess
import sys
import termios
import time

try:
    for cancel in [False, True]:
        master, slave = pty.openpty()
        code = 'import { hiddenLine } from ' + json.dumps('file://' + sys.argv[1]) + ';' + '''
import { createHash } from 'node:crypto';
try {
 const value = await hiddenLine(process.stdin, process.stdout, 'PRIVATE');
 process.stdout.write('DIGEST:'+createHash('sha256').update(value).digest('hex')+'\\n');
} catch { process.stdout.write('CANCELLED\\n'); }
if (process.stdin.isRaw) process.exitCode=1;
'''
        child = subprocess.Popen(['node', '--input-type=module', '-e', code], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
        captured = b''
        deadline = time.monotonic() + 5
        while b'PRIVATE: ' not in captured:
            if time.monotonic() > deadline:
                raise RuntimeError()
            if select.select([master], [], [], .1)[0]:
                captured += os.read(master, 4096)
        while termios.tcgetattr(slave)[3] & termios.ECHO:
            if time.monotonic() > deadline:
                raise RuntimeError()
            time.sleep(.01)
        value = ('Fixture-' + secrets.token_hex(16) + '-رمز').encode()
        os.write(master, value + (b'\x03' if cancel else b'\r'))
        deadline = time.monotonic() + 5
        while child.poll() is None:
            if time.monotonic() > deadline:
                child.kill()
                raise RuntimeError()
            if select.select([master], [], [], .05)[0]:
                captured += os.read(master, 4096)
        while select.select([master], [], [], .02)[0]:
            captured += os.read(master, 4096)
        if child.returncode != 0 or value in captured or not termios.tcgetattr(slave)[3] & termios.ECHO:
            raise RuntimeError()
        expected = b'CANCELLED' if cancel else b'DIGEST:' + hashlib.sha256(value).hexdigest().encode()
        if expected not in captured:
            raise RuntimeError()
        os.close(master)
        os.close(slave)
except BaseException:
    print('ADMIN_PRIVATE_PTY_TEST_FAILED', file=sys.stderr)
    sys.exit(1)
