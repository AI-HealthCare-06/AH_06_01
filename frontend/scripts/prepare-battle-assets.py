"""Prepare the Figma 14/15/16 PNG fills for the 160x120 battle renderer.

Input: a directory containing the original, unmodified exported PNG fills.
Output: compact native-resolution pixel-art atlases + reference bounds, never whole Figma UI renders.
"""
import json
import sys
from pathlib import Path
from PIL import Image

source = Path(sys.argv[1])
output = Path(__file__).resolve().parents[1] / 'public/assets/battle'
frames = {}
bounds = {}
for path in sorted(source.glob('*.png')):
    name = path.stem
    if not (name.startswith(('Melee', 'Ranged')) or 'Spritesheet' in name):
        continue
    image = Image.open(path).convert('RGBA')
    image.putalpha(image.getchannel('A').point(lambda alpha: 255 if alpha > 128 else 0))
    columns, rows = (4, 4 if 'WalkSpritesheet' in name else 3) if 'Spritesheet' in name else ((4, 2) if name.endswith('Attack') else (1, 1))
    poses = []
    for row in range(rows):
        for col in range(columns):
            cell = image.crop((round(col * image.width / columns), round(row * image.height / rows), round((col + 1) * image.width / columns), round((row + 1) * image.height / rows)))
            box = cell.getchannel('A').getbbox()
            if not box:
                raise ValueError(f'Empty frame: {name} {row} {col}')
            poses.append(cell.crop(box))
    scale = min(160 / max(p.width for p in poses), 120 / max(p.height for p in poses))
    atlas = Image.new('RGBA', (160 * columns, 120 * rows))
    for index, pose in enumerate(poses):
        pose = pose.resize((round(pose.width * scale), round(pose.height * scale)), Image.Resampling.NEAREST)
        atlas.alpha_composite(pose, ((index % columns) * 160 + (160 - pose.width) // 2, (index // columns) * 120 + 120 - pose.height))
    atlas.save(output / path.name, optimize=True)
    frames['/assets/battle/' + path.name] = [[(i % columns) * 160, (i // columns) * 120, 160, 120] for i in range(len(poses))]
    # Alpha bounds at the same resolution as BattleSprite's render buffer.
    first = atlas.crop((0, 0, 160, 120)).resize((160, 120), Image.Resampling.NEAREST)
    x, y, right, bottom = first.getchannel('A').getbbox()
    bounds[name] = [x, y, right-x, bottom-y]
target = Path(__file__).resolve().parents[1] / 'src/design/animation-atlases.json'
target.write_text(json.dumps({'frames': frames, 'bounds': bounds}, indent=2) + '\n')
print(f'Prepared {len(bounds)} assets, {len(frames)} animation sheets.')
