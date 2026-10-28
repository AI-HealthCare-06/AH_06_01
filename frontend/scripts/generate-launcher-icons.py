"""Build Android adaptive launcher icons from the existing pixel face assets."""
from pathlib import Path
from PIL import Image

frontend = Path(__file__).resolve().parents[1]
resources = frontend / "android/app/src/main/res"
faces = [
    ("tyranno", "493-579"), ("tricera", "493-582"), ("raptor", "493-592"),
    ("stego", "493-585"), ("ptera", "493-589"), ("brachio", "493-595"),
]
foregrounds = resources / "drawable-nodpi"
adaptive = resources / "mipmap-anydpi-v26"
foregrounds.mkdir(parents=True, exist_ok=True)
adaptive.mkdir(parents=True, exist_ok=True)
for name, node in faces:
    face = Image.open(frontend / f"public/assets/battle/{node}.png").convert("RGBA")
    face = face.crop(face.getbbox())
    factor = min(256 / face.width, 256 / face.height)
    face = face.resize((round(face.width * factor), round(face.height * factor)), Image.Resampling.NEAREST)
    icon = Image.new("RGBA", (432, 432))
    icon.alpha_composite(face, ((432 - face.width) // 2, (432 - face.height) // 2))
    icon.save(foregrounds / f"launcher_{name}.png", optimize=True)
    (adaptive / f"ic_dino_{name}.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/launcher_background" />\n'
        f'    <foreground android:drawable="@drawable/launcher_{name}" />\n'
        '</adaptive-icon>\n', encoding="utf-8")
(resources / "values/launcher_colors.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    '    <color name="launcher_background">#F3E7C4</color>\n</resources>\n', encoding="utf-8")
print("Generated 6 adaptive dinosaur face icons")
