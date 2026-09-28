"""Builds data/puzzles.json from a lichess puzzle CSV (CC0, https://database.lichess.org/#puzzles).

Usage: python3 tools/build-puzzles.py path/to/puzzles.csv
The CSV needs the lichess columns PuzzleId, FEN, Moves, Rating, Themes.
Puzzles are sampled per theme and spread across ratings (more weight below 1400).
"""
import csv, json, os, random, sys
from collections import defaultdict

TARGETS = {
    'mateIn1': 260, 'mateIn2': 260, 'mateIn3': 160, 'mateIn4': 60, 'mateIn5': 30,
    'fork': 260, 'pin': 220, 'skewer': 160, 'hangingPiece': 220, 'discoveredAttack': 180,
    'doubleCheck': 100, 'sacrifice': 200, 'deflection': 150, 'attraction': 120, 'trappedPiece': 110,
    'quietMove': 120, 'promotion': 150, 'backRankMate': 160, 'smotheredMate': 100, 'defensiveMove': 130,
    'zugzwang': 80, 'intermezzo': 80, 'xRayAttack': 60, 'capturingDefender': 80, 'attackingF2F7': 100,
    'kingsideAttack': 150, 'exposedKing': 100, 'clearance': 60, 'interference': 50, 'enPassant': 40,
    'underPromotion': 20, 'castling': 20, 'equality': 60,
    'opening': 260, 'middlegame': 450, 'endgame': 450, 'rookEndgame': 160, 'pawnEndgame': 160,
    'queenEndgame': 60, 'bishopEndgame': 60, 'knightEndgame': 60,
}
SKIP_THEMES = {'master', 'masterVsMaster', 'superGM'}
LO, HI, STEP = 400, 2400, 100


def main(path):
    random.seed(20260928)
    rows = []
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            moves = r['Moves'].split()
            rating = int(r['Rating'])
            if not (LO <= rating < HI) or len(moves) > 12 or len(moves) < 2:
                continue
            rows.append((r['PuzzleId'], r['FEN'], r['Moves'], rating, r['Themes'].split()))
    by_theme = defaultdict(lambda: defaultdict(list))
    for row in rows:
        b = (row[3] - LO) // STEP
        for t in row[4]:
            by_theme[t][b].append(row)
    buckets = list(range((HI - LO) // STEP))
    # Round-robin order that visits the easier buckets (< 1400) more often.
    order = [b for b in buckets for _ in range(2 if LO + b * STEP < 1400 else 1)]
    chosen = {}
    for theme, target in TARGETS.items():
        pools = {b: random.sample(v, len(v)) for b, v in by_theme[theme].items()}
        got, i, empty = 0, 0, 0
        while got < target and empty < len(order):
            b = order[i % len(order)]
            i += 1
            pool = pools.get(b)
            if not pool:
                empty += 1
                continue
            empty = 0
            row = pool.pop()
            if row[0] not in chosen:
                chosen[row[0]] = row
                got += 1
    themes = sorted({t for r in chosen.values() for t in r[4]} - SKIP_THEMES)
    idx = {t: i for i, t in enumerate(themes)}
    out = [[r[0], r[1], r[2], r[3], '.'.join(str(idx[t]) for t in r[4] if t in idx)]
           for r in sorted(chosen.values(), key=lambda r: r[3])]
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'puzzles.json')
    with open(dest, 'w') as f:
        json.dump({'t': themes, 'p': out}, f, separators=(',', ':'))
    print(len(out), 'puzzles,', len(themes), 'themes,', os.path.getsize(dest), 'bytes')


if __name__ == '__main__':
    main(sys.argv[1])
