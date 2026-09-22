#!/usr/bin/env python3
"""Isolated, pinned native builds with identical benchmark-only allocator instrumentation."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tarfile
p = argparse.ArgumentParser()
p.add_argument('--rspack', required=True)
p.add_argument('--work', required=True)
p.add_argument('--main', default='origin/main')
p.add_argument('--branch', default='HEAD')
p.add_argument('--jobs', default='8')
a = p.parse_args()
repo = pathlib.Path(a.rspack).resolve(); work = pathlib.Path(a.work).resolve()
work.mkdir(parents=True, exist_ok=True)
here = pathlib.Path(__file__).resolve().parent
manifest = {'profile': {'optLevel': 3, 'lto': 'off', 'codegenUnits': 16, 'allocator': 'mimalloc v3 + requested-byte counters', 'features': ['info-level']}, 'versions': {}, 'rustc': subprocess.check_output(['rustc', '-Vv'], cwd=repo, text=True), 'cargo': subprocess.check_output(['cargo', '-V'], cwd=repo, text=True), 'environment': {key: os.environ.get(key) for key in ['RUSTFLAGS', 'RUSTC_WRAPPER', 'CC', 'CFLAGS', 'CARGO_ENCODED_RUSTFLAGS']}}
for label, ref in [('main', a.main), ('branch', a.branch)]:
    sha = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', ref], text=True).strip()
    source = work / label
    if source.exists(): raise RuntimeError(f'Refusing to overwrite {source}')
    source.mkdir()
    archive = subprocess.Popen(['git', '-C', str(repo), 'archive', sha], stdout=subprocess.PIPE)
    with tarfile.open(fileobj=archive.stdout, mode='r|') as tar: tar.extractall(source, filter='data')
    assert archive.wait() == 0
    # git archive preserves old commit timestamps. Refresh them before sharing a
    # Cargo target directory, or Cargo can incorrectly reuse the other revision.
    for file in source.rglob("*"):
        if file.is_file(): os.utime(file, None)
    allocator = source / 'crates/rspack_allocator/src/lib.rs'
    original = allocator.read_text(); allocator.write_text((here / 'allocator.rs').read_text())
    binding = source / 'crates/rspack_binding_api/src/lib.rs'
    binding.write_text(binding.read_text() + '''\n// Benchmark-only API; no exported product API changes.\n#[napi]\npub fn benchmark_memory(reset_peak: bool) -> Vec<f64> {\n  rspack_allocator::benchmark_memory(reset_peak).to_vec()\n}\n''')
    import difflib
    patch = ''.join(difflib.unified_diff(original.splitlines(True), allocator.read_text().splitlines(True), fromfile='a/crates/rspack_allocator/src/lib.rs', tofile='b/crates/rspack_allocator/src/lib.rs'))
    original_binding = subprocess.check_output(['git', '-C', str(repo), 'show', sha + ':crates/rspack_binding_api/src/lib.rs'], text=True)
    patch += ''.join(difflib.unified_diff(original_binding.splitlines(True), binding.read_text().splitlines(True), fromfile='a/crates/rspack_binding_api/src/lib.rs', tofile='b/crates/rspack_binding_api/src/lib.rs'))
    (work / f'{label}-instrumentation.patch').write_text(patch)
    env = dict(os.environ, CARGO_TARGET_DIR=str(work / 'target'), CARGO_BUILD_JOBS=a.jobs,
        CARGO_PROFILE_RELEASE_LTO='off', CARGO_PROFILE_RELEASE_CODEGEN_UNITS='16')
    cmd = ['cargo', 'build', '--locked', '--release', '-p', 'rspack_node', '--features', 'info-level']
    print(f'Building {label} {sha}', flush=True)
    with (work / f'{label}-build.log').open('w') as log:
        subprocess.run(cmd, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    native = work / f'{label}.node'
    shutil.copy2(work / 'target/release/librspack_node.so', native)
    manifest['versions'][label] = {'sha': sha, 'native': str(native), 'nativeSha256': hashlib.sha256(native.read_bytes()).hexdigest(), 'instrumentationSha256': hashlib.sha256(patch.encode()).hexdigest(), 'command': cmd}
    (work / 'builds.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Built {native}', flush=True)
print(work / 'builds.json')
