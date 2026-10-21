#!/usr/bin/python3
"""Exact-image, normal 24-hour renewal for the replacement restricted server."""

import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time

ROOT = Path('/opt/hambazi/security')
TIMER = Path('/etc/systemd/system/hambazi-server-security-expiry.timer')
TOOL_SHA = 'd89bcc6510a267f11b773398cbf1be5520ce39f9e8b6633178c4487f05b7d791'
ROLES = {'api', 'bot', 'worker', 'web', 'postgres-staging', 'redis-staging'}
ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
       'HOME': '/root', 'LANG': 'C.UTF-8', 'DOCKER_HOST': 'unix:///var/run/docker.sock'}


def require(condition):
    if not condition:
        raise ValueError('REPLACEMENT_SECURITY_BLOCKED')


def timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None)
    return parsed.timestamp()


def normal_expiry(metadata, reports, pins, now):
    require(metadata.get('Version') == 2 and set(pins) == ROLES and set(reports) == ROLES)
    dates = [timestamp(metadata[k]) for k in ['UpdatedAt', 'DownloadedAt']]
    require(all(t <= now + 300 and now - t < 86400 for t in dates))
    for role, image in pins.items():
        require(re.fullmatch(r'[^\s@]+@sha256:[a-f0-9]{64}', image) is not None)
        report = reports[role]
        require(report.get('SchemaVersion') == 2 and report.get('ArtifactName') == image)
        results = report.get('Results')
        require(isinstance(results, list) and any(r.get('Class') == 'os-pkgs' for r in results))
        for result in results:
            for finding in result.get('Vulnerabilities', []):
                require(finding.get('Severity') in ['LOW', 'MEDIUM', 'INFO'])
    return dt.datetime.fromtimestamp(int(min(dates) + 86400), dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def digest(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


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
        raise RuntimeError('REPLACEMENT_SECURITY_COMMAND_FAILED')
    return result.stdout.strip()


def identity(control):
    require(run(['docker', 'info', '--format', '{{.ID}}']) == control['dockerDaemonId'])
    addresses = json.loads(run(['ip', '-j', '-4', 'address', 'show']))
    require(any(a.get('local') == control['address'] for i in addresses for a in i.get('addr_info', [])))
    containers = {}
    for role, expected in control['containers'].items():
        value = json.loads(run(['docker', 'inspect', 'hambazi-server-' + role + '-1']))[0]
        require(value['Id'] == expected['containerId'] and value['Image'] == expected['imageId'])
        require(value['Config']['Image'] == control['pins'][role])
        require(not value['HostConfig']['PortBindings'])
        containers[role] = value
    return containers


def verify(control):
    require(control['active'] is True and set(control['pins']) == ROLES)
    containers = identity(control)
    packages = run(['dpkg-query', '-W', '-f=${Package}=${Version}\n',
                    'nginx', 'nginx-common', 'certbot', 'python3-certbot', 'python3-acme', 'openssl'])
    require(packages == control['hostPackages'])
    for path, expected in control['files'].items():
        info = Path(path).lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1)
        if path.endswith(('.env', '-key.pem', 'admission.json')):
            require(info.st_mode & 0o077 == 0)
        require(digest(path) == expected)
    private = json.loads(run(['docker', 'network', 'inspect', 'hambazi-server-private']))[0]
    require(private['Internal'] is True)
    for role, port in [('api', 8081), ('bot', 8082), ('worker', 8083), ('web', 8081)]:
        value = containers[role]
        require(value['State']['Running'] and value['State']['Health']['Status'] == 'healthy')
        require(value['Config']['User'] == '1000:1000' and value['HostConfig']['ReadonlyRootfs'])
        require(value['HostConfig']['CapDrop'] == ['ALL'])
        require('no-new-privileges:true' in value['HostConfig']['SecurityOpt'])
        probe = "const r=await fetch('http://127.0.0.1:PORT/v1/health/ready');const b=await r.json();if(r.status!==200||b.status!=='READY')process.exit(1)".replace('PORT', str(port))
        run(['docker', 'exec', 'hambazi-server-' + role + '-1', 'node', '-e', probe])
    return {role: (v['Id'], v['State']['StartedAt']) for role, v in containers.items()}


def write_timer(deadline):
    calendar = dt.datetime.fromtimestamp(timestamp(deadline), dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    TIMER.write_text('[Unit]\nDescription=Restricted HamBazi security evidence expiry\n[Timer]\nOnCalendar=' + calendar + '\nPersistent=true\nUnit=hambazi-server-security-contain.service\n[Install]\nWantedBy=timers.target\n')
    TIMER.chmod(0o644)
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'restart', TIMER.name])


def renew(control):
    require(digest(ROOT / 'trivy') == TOOL_SHA)
    state = private_json(ROOT / 'state.json')
    require(timestamp(state['deadlineUTC']) - time.time() > 900)
    before = verify(control)
    tool = str(ROOT / 'trivy')
    cache = str(ROOT / 'cache')
    run([tool, 'image', '--download-db-only', '--db-repository', 'ghcr.io/aquasecurity/trivy-db:2',
         '--cache-dir', cache, '--quiet', '--timeout', '10m'], 660)
    reports = {}
    for role, image in control['pins'].items():
        path = ROOT / (role + '.scan.private.json')
        run([tool, 'image', '--skip-db-update', '--skip-java-db-update', '--offline-scan',
             '--parallel', '1', '--scanners=vuln', '--image-src=docker', '--format=json', '--output', str(path),
             '--cache-dir', cache, '--quiet', image], 180)
        path.chmod(0o600)
        require(path.stat().st_size <= 64 * 1024 * 1024)
        reports[role] = json.loads(path.read_text())
    metadata = json.loads((ROOT / 'cache/db/metadata.json').read_text())
    deadline = normal_expiry(metadata, reports, control['pins'], time.time())
    require(private_json(ROOT / 'control.json') == control)
    require(before == verify(control) and timestamp(state['deadlineUTC']) - time.time() > 900)
    result = 'unchanged'
    if timestamp(deadline) > timestamp(state['deadlineUTC']):
        write_timer(deadline)
        save(ROOT / 'state.json', {'deadlineUTC': deadline, 'database': metadata})
        result = 'renewed'
    save(ROOT / 'last-run.json', {'ok': True, 'result': result,
         'checkedAtUTC': dt.datetime.now(dt.timezone.utc).isoformat(), 'deadlineUTC': deadline,
         'images': len(reports), 'database': metadata})
    print(json.dumps({'event': 'security.renew.completed', 'result': result, 'deadlineUTC': deadline}))


def contain(control):
    # The persistent timer owns the deadline. This is also explicit operator maintenance.
    # A damaged renewal-state file must not prevent a scheduled containment.
    identity(control)
    try:
        maintenance = '/opt/hambazi/evidence/https-maintenance.conf'
        require(digest(maintenance) == control['files'][maintenance])
        shutil.copyfile(maintenance, '/etc/nginx/sites-available/hambazi')
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
    finally:
        failures = []
        for role, budget in [('bot', 45), ('api', 40), ('worker', 70), ('web', 10)]:
            name = 'hambazi-server-' + role + '-1'
            try:
                run(['docker', 'stop', '--time', str(budget), name], budget + 15)
                require(run(['docker', 'inspect', '--format', '{{.State.ExitCode}}', name]) == '0')
            except Exception:
                failures.append(role)
        require(not failures)
    print(json.dumps({'event': 'security.expiry.contained', 'dataServicesPreserved': True}))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        with (ROOT / 'run.lock').open('a') as lock:
            if sys.argv[1:] == ['--renew']:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            control = private_json(ROOT / 'control.json')
            if sys.argv[1:] == ['--renew']:
                renew(control)
            elif sys.argv[1:] == ['--contain']:
                contain(control)
            elif sys.argv[1:] == ['--verify']:
                verify(control)
                print('REPLACEMENT_SECURITY_BINDING_VERIFIED')
            else:
                raise ValueError('INVALID_MODE')
    except Exception:
        try:
            save(ROOT / 'last-failure.json', {'errorCode': 'REPLACEMENT_SECURITY_BLOCKED',
                 'checkedAtUTC': dt.datetime.now(dt.timezone.utc).isoformat()})
        except OSError:
            pass
        print(json.dumps({'event': 'security.operation.failed', 'errorCode': 'REPLACEMENT_SECURITY_BLOCKED'}))
        sys.exit(1)
