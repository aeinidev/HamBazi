#!/usr/bin/python3
"""Admin-only Certbot deploy hook. Candidate: never installed automatically.

Reuses the host Certbot timer; no workstation tunnel/proxy dependency. Certbot
egress and a real --dry-run --run-deploy-hooks remain mandatory release gates.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import socket
import ssl
import stat
import subprocess
import sys
import time

LINEAGE = Path('/etc/letsencrypt/live/hambazi-admin')
ARCHIVE = Path('/etc/letsencrypt/archive/hambazi-admin')
HOSTNAME = 'admin.hambazi.top'
RECEIPT = Path('/opt/hambazi/admin/security/certificate-renewal.json')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8'}


def require(value):
    if not value:
        raise ValueError('ADMIN_CERTIFICATE_INVALID')


def command(args, data=None):
    value = subprocess.run(args, input=data, capture_output=True, timeout=30, env=ENV)
    require(value.returncode == 0)
    return value.stdout


def check_files(lineage=LINEAGE):
    # Certbot's symlinks are intentional, but all resolved files must stay inside
    # the approved lineage's root-owned, non-writable archive directory.
    for parent in [Path('/etc/letsencrypt'), LINEAGE.parent, LINEAGE, ARCHIVE.parent, ARCHIVE]:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o022 == 0)
    for name in ['cert.pem', 'chain.pem', 'fullchain.pem', 'privkey.pem']:
        path = (lineage / name).resolve(strict=True)
        require(path.parent == ARCHIVE)
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1)
        require(info.st_mode & (0o077 if name == 'privkey.pem' else 0o022) == 0)


def validate_certificate(lineage=LINEAGE, run=command):
    cert, chain, key = [str(lineage / name) for name in ['cert.pem', 'chain.pem', 'privkey.pem']]
    run(['openssl', 'verify', '-purpose', 'sslserver', '-verify_hostname', HOSTNAME,
         '-CApath', '/etc/ssl/certs', '-untrusted', chain, cert])
    run(['openssl', 'x509', '-in', cert, '-noout', '-checkend', '604800'])
    public = run(['openssl', 'x509', '-in', cert, '-noout', '-pubkey'])
    public_der = run(['openssl', 'pkey', '-pubin', '-outform', 'DER'], public)
    # Only the public half of the private key is ever returned by OpenSSL.
    key_der = run(['openssl', 'pkey', '-in', key, '-pubout', '-outform', 'DER'])
    require(public_der == key_der)
    return hashlib.sha256(run(['openssl', 'x509', '-in', cert, '-outform', 'DER'])).hexdigest()


def served_certificate():
    with socket.create_connection(('127.0.0.1', 443), timeout=5) as connection:
        with ssl.create_default_context(capath='/etc/ssl/certs').wrap_socket(connection, server_hostname=HOSTNAME) as tls:
            return hashlib.sha256(tls.getpeercert(binary_form=True)).hexdigest()


def deploy(lineage, run=command, check=check_files, probe=served_certificate, save=None):
    # Global Certbot deploy hooks also see player certificates. Ignore them.
    if lineage != str(LINEAGE):
        return False
    check()
    fingerprint = validate_certificate(run=run)
    run(['nginx', '-t'])
    run(['systemctl', 'reload', 'nginx'])
    for attempt in range(10):
        if probe() == fingerprint:
            break
        if attempt == 9:
            raise ValueError('ADMIN_CERTIFICATE_NOT_SERVED')
        time.sleep(0.1)
    receipt = {'hostname': HOSTNAME, 'lineage': 'hambazi-admin',
               'checkedAtUTC': dt.datetime.now(dt.timezone.utc).isoformat(),
               'servedCertificateSHA256': fingerprint,
               'validation': 'system-ca+hostname+key-match+live-leaf'}
    if save is not None:
        save(receipt)
    else:
        temporary = RECEIPT.with_suffix('.next')
        temporary.write_text(json.dumps(receipt, indent=2) + '\n')
        temporary.chmod(0o600)
        temporary.replace(RECEIPT)
    return True


if __name__ == '__main__':
    os.umask(0o077)
    try:
        require(os.geteuid() == 0 and len(sys.argv) == 1)
        lineage = os.environ.get('RENEWED_LINEAGE')
        require(isinstance(lineage, str) and len(lineage) > 0)
        if deploy(lineage):
            print('ADMIN_CERTIFICATE_RENEWAL_VERIFIED')
    except Exception:
        # Raw subprocess/SSL errors and ACME material never leave this hook.
        print('ADMIN_CERTIFICATE_RENEWAL_FAILED', file=sys.stderr)
        sys.exit(1)
