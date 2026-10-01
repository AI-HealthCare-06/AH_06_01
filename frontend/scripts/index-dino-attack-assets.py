"""Index original generated sprite poses without modifying the image files.

The generated sheets use visually spaced rows rather than perfectly even cells.
Connected opaque silhouettes provide whole-pose rectangles without clipping wings.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

def connected_boxes(alpha):
    """Run-length connected components; requires only NumPy and Pillow."""
    parents, runs, previous = [], [], []
    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    for y, row in enumerate(alpha):
        edges = np.diff(np.r_[False, row, False].astype(np.int8))
        current = []
        for start, end in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)):
            start, end = int(start), int(end)
            i = len(parents); parents.append(i); runs.append((start, end, y))
            for ps, pe, p in previous:
                if pe >= start and ps <= end:
                    parents[find(i)] = find(p)
            current.append((start, end, i))
        previous = current
    boxes = {}
    for i, (start, end, y) in enumerate(runs):
        key = find(i)
        if key not in boxes: boxes[key] = [start, y, end, y + 1, 0]
        b = boxes[key]
        b[0] = min(b[0], start); b[1] = min(b[1], y)
        b[2] = max(b[2], end); b[3] = max(b[3], y + 1); b[4] += end - start
    return sorted(boxes.values(), key=lambda b: b[4], reverse=True)[:8]

root = Path(__file__).resolve().parents[1]
names = ['Trex', 'Tricera', 'Raptor', 'Stego', 'Brachio', 'PteraMelee', 'Ptera']
result = {'frames': {}, 'firstBounds': {}, 'releasePoints': {}}
review = root.parent / 'tmp/dino-attack-review'
review.mkdir(parents=True, exist_ok=True)
for name in names:
    filename = 'DinoPteraMeleeAttack.png' if name == 'PteraMelee' else f'Dino{name}RangedAttack.png'
    if name == 'Raptor': filename = 'DinoRaptorClawRangedAttack.png'
    image = Image.open(root / 'public/assets/battle' / filename).convert('RGBA')
    poses = []
    for x, y, right, bottom, _ in connected_boxes(np.asarray(image.getchannel('A')) > 128):
        poses.append([x, y, right - x, bottom - y])
    if name == 'Ptera':
        poses.sort(key=lambda p: p[0])
    else:
        poses.sort(key=lambda p: p[1] + p[3] / 2)
        poses = sorted(poses[:4], key=lambda p: p[0]) + sorted(poses[4:], key=lambda p: p[0])
    result['frames']['/assets/battle/' + filename] = poses
    result['firstBounds'][name] = poses[0][2:]
    for index, (x, y, w, h) in enumerate(poses):
        if index in [0, 2]: image.crop((x, y, x + w, y + h)).save(review / f'{name}-pose-{index}.png')
    print(name, poses)
# Release points (Raptor's foreclaws; other dinosaurs' mouths) use IDLE-aligned 160x120 coordinates.
# Kept separate from source pixels so sprite size and world position share them.
result['releasePoints'] = {
    'Trex': [150, 56], 'Tricera': [151, 82], 'Raptor': [159, 91],
    'Stego': [155, 86], 'Ptera': [148, 104], 'Brachio': [127, 31],
}
(root / 'src/design/dino-attack-atlases.json').write_text(json.dumps(result, indent=2) + '\n')
