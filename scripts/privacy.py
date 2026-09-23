#!/usr/bin/env python3
"""Check/sanitize files selected for publication, without touching ignored runs."""

import argparse
from contextlib import ExitStack
import copy
import gzip
import io
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile


# Include mount prefixes and both plain and JSON-escaped Windows paths.
POSIX_HOME = re.compile(r'/(?:[\w.-]+/){0,4}(?:home|Users)/[\w.@-]+')
WINDOWS_HOME = re.compile(r'''[A-Za-z]:\\+(?:Users|Documents and Settings)\\+[^\\/\r\n"'<>]+''')
PATH_OR_URL = re.compile(
    r'''https?://[^\s"'<>`]+|''' + POSIX_HOME.pattern + '|' + WINDOWS_HOME.pattern
    + r'''|/root(?=/|["\s]|$)'''
)
SECRET = re.compile(
    r'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b'
    r'|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----'
)


def sanitize_text(text):
    return PATH_OR_URL.sub(lambda match: match[0] if match[0].startswith(('http://', 'https://')) else '~', text)


def sanitize_bytes(data, label):
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        raise ValueError(f'{label}: unsupported binary file; inspect before publication') from None
    if SECRET.search(text):
        raise ValueError(f'{label}: possible credential; remove it manually before publication')
    return sanitize_text(text).encode('utf-8')


def sanitize_tar(source, destination=None):
    changed = False
    # Stream members without extracting paths or following archive links.
    with ExitStack() as stack:
        archive = stack.enter_context(tarfile.open(fileobj=source, mode='r|gz'))
        output = None
        if destination is not None:
            compressed = stack.enter_context(gzip.GzipFile(fileobj=destination, mode='wb', filename='', mtime=0))
            output = stack.enter_context(tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT))
        for member in archive:
            clean = copy.copy(member)
            clean.name = sanitize_text(member.name)
            clean.linkname = sanitize_text(member.linkname)
            clean.uid = clean.gid = 0
            clean.uname = clean.gname = ''
            clean.pax_headers = {
                key: sanitize_text(value) for key, value in member.pax_headers.items()
                if key not in {'uid', 'gid', 'uname', 'gname'}
            }
            changed |= any(getattr(clean, key) != getattr(member, key) for key in
                           ('name', 'linkname', 'uid', 'gid', 'uname', 'gname', 'pax_headers'))
            data = None
            if member.isfile():
                original = archive.extractfile(member).read()
                data = sanitize_bytes(original, member.name)
                changed |= data != original
                clean.size = len(data)
                if 'size' in clean.pax_headers:
                    clean.pax_headers['size'] = str(clean.size)
            if output is not None:
                output.addfile(clean, io.BytesIO(data) if data is not None else None)
    return changed


def process_file(file, write=False):
    if file.is_symlink():
        target = os.readlink(file)
        if sanitize_text(target) != target:
            raise ValueError(f'{file}: personal path in symlink; replace it manually')
        return False
    if file.name.endswith('.tar.gz'):
        # Use a temporary file, so even large audit archives need only one member in memory.
        with tempfile.TemporaryFile() as output, file.open('rb') as source:
            header = source.read(4)
            source.seek(0)
            changed = sanitize_tar(source, output if write else None)
            changed |= bool(header[3] & 0x18)
            if changed and write:
                output.seek(0)
                with file.open('wb') as target:
                    shutil.copyfileobj(output, target)
        return changed
    original = file.read_bytes()
    if file.suffix == '.gz':
        data = gzip.decompress(original)
        clean = sanitize_bytes(data, file)
        # FNAME/FCOMMENT can disclose paths even when the payload is already clean.
        changed = clean != data or bool(original[3] & 0x18)
        result = gzip.compress(clean, mtime=0) if changed else original
    else:
        result = sanitize_bytes(original, file)
        changed = result != original
    if changed and write:
        file.write_bytes(result)
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--write', action='store_true', help='sanitize publication files in place')
    mode.add_argument('--check', action='store_true', help='fail if sanitization is needed (default)')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    names = subprocess.check_output([
        'git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard',
    ], cwd=root).decode().split('\0')
    changed = errors = 0
    for name in sorted(set(names) - {''}):
        file = root / name
        if not file.exists() and not file.is_symlink():
            continue  # A tracked deletion has no content to publish.
        try:
            if process_file(file, args.write):
                changed += 1
                print(('Sanitized: ' if args.write else 'Needs sanitization: ') + name)
        except (ValueError, OSError, tarfile.TarError, EOFError) as error:
            errors += 1
            print(sanitize_text(str(error)))
    print(f'{changed} files {"sanitized" if args.write else "need sanitization"}; {errors} errors')
    return int(bool(errors or (changed and not args.write)))


if __name__ == '__main__':
    raise SystemExit(main())
