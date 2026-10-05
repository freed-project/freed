import hashlib, json, pathlib, subprocess
root = pathlib.Path(__file__).parent
metadata = json.loads((root / 'gliclass-official-model-metadata.json').read_text())
assert metadata['sha'] == '77a70e6cd52e602ed18184ef37d18bdd3741e3d5'
assert metadata['cardData']['license'] == 'apache-2.0'
model = root / 'model'; model.mkdir(exist_ok=True)
manifest = []
for entry in metadata['siblings']:
    name = entry['rfilename']
    if name not in ['config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json', 'spm.model']: continue
    target = model / name
    url = 'https://huggingface.co/knowledgator/gliclass-base-v3.0/resolve/' + metadata['sha'] + '/' + name
    if not target.exists():
        partial = pathlib.Path(str(target) + '.partial')
        subprocess.run(['curl', '-sSL', '--fail', '--retry', '3', '--max-time', '1200', '-C', '-', url, '-o', str(partial)], check=True)
        partial.rename(target)
    assert target.stat().st_size == entry['size'], name + ' size mismatch'
    digest = hashlib.sha256(); git_digest = hashlib.sha1(); git_digest.update(f"blob {entry['size']}\0".encode())
    with target.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): digest.update(block); git_digest.update(block)
    if 'lfs' in entry: assert digest.hexdigest() == entry['lfs']['sha256'], name + ' SHA256 mismatch'
    else: assert git_digest.hexdigest() == entry['blobId'], name + ' Git blob mismatch'
    manifest.append({'path':name, 'sizeBytes':entry['size'], 'sha256':digest.hexdigest()})
    print(name, entry['size'], digest.hexdigest(), flush=True)
(root / 'verified-source-manifest.json').write_text(json.dumps({'revision':metadata['sha'], 'files':manifest}, indent=2))
