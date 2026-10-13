"""Build battle atlases from the original Figma 10/19/20/21 image fills.

Pass the directory of original PNGs (names below). This only packs authored
poses at battle resolution; reference UI screenshots are never game assets.
"""
import json
import sys
from pathlib import Path
from PIL import Image

source = Path(sys.argv[1])
root = Path(__file__).resolve().parents[1]
out = root / 'public/assets/battle'
manifest = {'frames': {}, 'bounds': {}, 'frameBounds': {}}
names = ['Brachio', 'Tricera', 'Stego']
specs = [(f'{name}{mode}', f'Dino{name}{mode}', 4, 3 if mode == 'Idle' else 4, None)
         for name in names for mode in ['Idle', 'Walk']]
specs += [('StegoTailSweepV2', 'DinoStegoTailSweepV2', 4, 3, 12)]
specs += [(p.stem, p.stem, 4, 2, None) for p in source.glob('*Walk.png')
          if p.stem.startswith(('Melee', 'Ranged'))]
specs += [(f'{name}Projectile', f'Dino{name}Projectile', 4, 1, None)
          for name in ['Trex', 'Tricera', 'Raptor', 'Stego', 'Ptera', 'Brachio']]
for filename, name, cols, rows, count in specs:
    image = Image.open(source / (filename + '.png')).convert('RGBA')
    # These two original exports include a thin fragment of the preceding row.
    # The projectile artwork begins below y=20; exclude only that unrelated edge.
    if filename in ('RaptorProjectile', 'TriceraProjectile'):
        image = image.crop((0, 20, image.width, image.height))
    image.putalpha(image.getchannel('A').point(lambda a: 255 if a > 128 else 0))
    poses = []
    for i in range(count or cols * rows):
        col, row = i % cols, i // cols
        cell = image.crop((round(col * image.width / cols), round(row * image.height / rows),
                           round((col + 1) * image.width / cols), round((row + 1) * image.height / rows)))
        box = cell.getchannel('A').getbbox()
        if not box:
            raise ValueError(f'Empty pose {name}:{i}')
        poses.append(cell.crop(box))
    scale = min(160 / max(p.width for p in poses), 120 / max(p.height for p in poses))
    atlas = Image.new('RGBA', (160 * cols, 120 * rows))
    frame_bounds = []
    for i, pose in enumerate(poses):
        pose = pose.resize((round(pose.width * scale), round(pose.height * scale)), Image.Resampling.NEAREST)
        x, y = (160 - pose.width) // 2, 120 - pose.height
        atlas.alpha_composite(pose, ((i % cols) * 160 + x, (i // cols) * 120 + y))
        # Nearest-neighbor downsampling can discard a one-pixel edge particle.
        # Record the final visible bounds, not the pre-resize crop rectangle.
        left, top, right, bottom = pose.getchannel('A').getbbox()
        frame_bounds.append([x + left, y + top, right - left, bottom - top])
    atlas.save(out / (name + '.png'), optimize=True)
    path = '/assets/battle/' + name + '.png'
    manifest['frames'][path] = [[(i % cols) * 160, (i // cols) * 120, 160, 120] for i in range(len(poses))]
    manifest['bounds'][name] = frame_bounds[0]
    manifest['frameBounds'][name] = frame_bounds
    print(name, len(poses), (out / (name + '.png')).stat().st_size)
(root / 'src/design/motion-atlases.json').write_text(json.dumps(manifest, indent=2) + '\n')
