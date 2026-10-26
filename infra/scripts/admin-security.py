#!/usr/bin/python3
"""Fail-closed security lifecycle for the isolated SSH-only Admin instance."""
import datetime as dt
import fcntl
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import os

ROOT = Path('/opt/hambazi/admin/security')
MARKER = Path('/var/www/hambazi-admin/maintenance')
TOOL_SHA = 'd89bcc6510a267f11b773398cbf1be5520ce39f9e8b6633178c4487f05b7d791'
ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
       'HOME': '/root', 'LANG': 'C.UTF-8', 'DOCKER_HOST': 'unix:///var/run/docker.sock'}


def require(value):
    if not value:
        raise ValueError('ADMIN_SECURITY_BLOCKED')


def timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None)
    return parsed.timestamp()


def scan_deadline(metadata, report, image, core_deadline, now):
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', image) is not None)
    require(metadata.get('Version') == 2 and report.get('SchemaVersion') == 2)
    require(report.get('ArtifactName') == image)
    dates = [timestamp(metadata[key]) for key in ['UpdatedAt', 'DownloadedAt']]
    require(all(value <= now + 300 and now - value < 86400 for value in dates))
    results = report.get('Results')
    require(isinstance(results, list) and any(r.get('Class') == 'os-pkgs' for r in results))
    for result in results:
        for finding in result.get('Vulnerabilities', []):
            require(finding.get('Severity') in ['LOW', 'MEDIUM', 'INFO'])
    deadline = min(min(dates) + 86400, timestamp(core_deadline))
    require(deadline > now + 900)
    return dt.datetime.fromtimestamp(int(deadline), dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def private_json(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o077 == 0)
    return json.loads(path.read_text())


def save(path, value):
    temporary = path.with_name(path.name + '.next')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def run(args, timeout=30):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=ENV)
    if result.returncode:
        log = ROOT / 'command.private.log'
        log.write_text(result.stdout + result.stderr)
        log.chmod(0o600)
        raise RuntimeError('ADMIN_SECURITY_COMMAND_FAILED')
    return result.stdout.strip()


def verify(control, require_running=True):
    now = time.time()
    require(control['active'] is True)
    state = private_json(ROOT / 'state.json')
    require(timestamp(state['deadlineUTC']) > now)
    core = private_json(Path('/opt/hambazi/security/state.json'))
    require(timestamp(core['deadlineUTC']) > now)
    evidence_deadline = scan_deadline(state['database'], private_json(ROOT / 'image.scan.private.json'),
                                      control['image'], core['deadlineUTC'], now)
    require(timestamp(state['deadlineUTC']) <= timestamp(evidence_deadline))
    require(not MARKER.exists())
    require(run(['docker', 'info', '--format', '{{.ID}}']) == control['dockerDaemonId'])
    for path, expected in control['files'].items():
        info = Path(path).lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and digest(path) == expected)
        if path.endswith(('.env', '-key.pem')):
            require(info.st_mode & 0o077 == 0)
    container = json.loads(run(['docker', 'inspect', 'hambazi-admin-api']))[0]
    require(container['Id'] == control['containerId'] and container['Image'] == control['image'])
    require(container['Config']['Image'] == control['image'] and container['Config']['User'] == '1000:1000')
    host = container['HostConfig']
    require(host['ReadonlyRootfs'] and not host['PortBindings'] and host['CapDrop'] == ['ALL'])
    require('no-new-privileges:true' in host['SecurityOpt'])
    require(set(container['NetworkSettings']['Networks']) == {'hambazi-server-private'})
    if require_running:
        require(container['State']['Running'] and container['State']['Health']['Status'] == 'healthy')
    return container['Id'], container['State']['StartedAt']


def write_timer(deadline):
    calendar = dt.datetime.fromtimestamp(timestamp(deadline), dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    timer = Path('/etc/systemd/system/hambazi-admin-security-expiry.timer')
    timer.write_text('[Unit]\nDescription=Private Admin security evidence expiry\n[Timer]\nOnCalendar=' + calendar + '\nPersistent=true\nUnit=hambazi-admin-security-contain.service\n[Install]\nWantedBy=timers.target\n')
    timer.chmod(0o644)
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'restart', timer.name])


def renew(control):
    require(digest('/opt/hambazi/security/trivy') == TOOL_SHA)
    state = private_json(ROOT / 'state.json')
    require(timestamp(state['deadlineUTC']) - time.time() > 900)
    before = verify(control)
    tool = '/opt/hambazi/security/trivy'
    cache = ROOT / 'cache'
    with tempfile.TemporaryDirectory(prefix='advisory-', dir=ROOT) as directory:
        run([tool, 'image', '--download-db-only', '--db-repository', 'ghcr.io/aquasecurity/trivy-db:2',
             '--cache-dir', directory, '--quiet', '--timeout', '10m'], 660)
        shutil.copytree(Path(directory) / 'db', cache / 'db', dirs_exist_ok=True)
    report_path = ROOT / 'image.scan.private.json'
    run([tool, 'image', '--skip-db-update', '--skip-java-db-update', '--offline-scan',
         '--parallel', '1', '--scanners=vuln', '--image-src=docker', '--format=json',
         '--output', str(report_path), '--cache-dir', str(cache), '--quiet', control['image']], 240)
    report_path.chmod(0o600)
    metadata = json.loads((cache / 'db/metadata.json').read_text())
    core = private_json(Path('/opt/hambazi/security/state.json'))
    deadline = scan_deadline(metadata, json.loads(report_path.read_text()), control['image'], core['deadlineUTC'], time.time())
    require(private_json(ROOT / 'control.json') == control and before == verify(control))
    require(timestamp(state['deadlineUTC']) - time.time() > 900)
    if timestamp(deadline) > timestamp(state['deadlineUTC']):
        write_timer(deadline)
        save(ROOT / 'state.json', {'deadlineUTC': deadline, 'database': metadata})
    save(ROOT / 'last-run.json', {'ok': True, 'checkedAtUTC': dt.datetime.now(dt.timezone.utc).isoformat(),
         'deadlineUTC': deadline})
    print(json.dumps({'event': 'admin.security.renewed', 'deadlineUTC': deadline}))


def contain():
    # Expired/damaged evidence must not prevent closing this Admin instance.
    MARKER.parent.mkdir(parents=True, exist_ok=True)
    MARKER.touch(mode=0o644, exist_ok=True)
    try:
        run(['systemctl', 'stop', 'hambazi-admin.service'], 40)
    finally:
        value = json.loads(run(['docker', 'inspect', 'hambazi-admin-api']))[0]
        if value['State']['Running']:
            run(['docker', 'stop', '--time', '15', 'hambazi-admin-api'], 30)
    print(json.dumps({'event': 'admin.security.contained', 'playerServicesPreserved': True}))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        if sys.argv[1:] == ['--contain']:
            contain()
        else:
            with (ROOT / 'run.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                control = private_json(ROOT / 'control.json')
                if sys.argv[1:] == ['--renew']:
                    renew(control)
                elif sys.argv[1:] in [['--verify'], ['--admit']]:
                    verify(control, require_running=sys.argv[1:] == ['--verify'])
                    print('ADMIN_SECURITY_BINDING_VERIFIED')
                else:
                    raise ValueError('ADMIN_SECURITY_MODE_INVALID')
    except Exception:
        print(json.dumps({'event': 'admin.security.failed', 'errorCode': 'ADMIN_SECURITY_BLOCKED'}))
        sys.exit(1)
