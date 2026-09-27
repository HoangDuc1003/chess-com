"""Builds a copy for a Claude artifact (no service worker, no isolation headers, fonts from Google Fonts).
Usage: python3 tools/build-artifact.py   -> dist-artifact/
"""
import os, re, shutil
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
out = os.path.join(root, 'dist-artifact')
shutil.rmtree(out, ignore_errors=True)
html = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
body = re.search(r'<!--BODY-->(.*)<!--/BODY-->', html, re.S).group(1)
css = open(os.path.join(root, 'app/style.css'), encoding='utf-8').read()
pieces = open(os.path.join(root, 'app/pieces.css'), encoding='utf-8').read()
page = ('<title>Đấu Stockfish</title>\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap">\n'
        f'<style>\n{css}\n{pieces}\n</style>\n{body}\n<script type="module" src="app/main.js"></script>\n')
os.makedirs(out)
open(os.path.join(out, 'dau-stockfish.html'), 'w', encoding='utf-8').write(page)
for d in ('app', 'lib', 'data'):
    shutil.copytree(os.path.join(root, d), os.path.join(out, d), ignore=shutil.ignore_patterns('*.css'))
os.makedirs(os.path.join(out, 'engine'))
for f in ('stockfish.js', 'stockfish.wasm', 'stockfish-asm.js'):
    shutil.copy(os.path.join(root, 'engine', f), os.path.join(out, 'engine', f))
print('built', out)
