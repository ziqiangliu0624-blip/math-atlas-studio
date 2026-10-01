"""Generate the local Windows app icon from simple vector-like geometry."""

from math import pi, sin
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
OUT.mkdir(exist_ok=True)

SIZE = 1024
image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((20, 20, SIZE - 20, SIZE - 20), radius=230, fill="#243552")

# A restrained coordinate grid makes the mark specific to graphing.
for position in range(192, 833, 128):
    draw.line((position, 132, position, 892), fill=(149, 178, 218, 38), width=3)
    draw.line((132, position, 892, position), fill=(149, 178, 218, 38), width=3)
draw.line((132, 512, 892, 512), fill=(176, 199, 229, 95), width=5)
draw.line((512, 132, 512, 892), fill=(176, 199, 229, 95), width=5)

points = []
for x in range(129, 896, 3):
    y = 512 - 166 * sin((x - 132) / 760 * 2.25 * pi)
    points.append((x, int(y)))
draw.line(points, fill="#d9e4ff", width=28, joint="curve")
for point in (points[0], points[-1]):
    draw.ellipse((point[0] - 14, point[1] - 14, point[0] + 14, point[1] + 14), fill="#d9e4ff")
draw.ellipse((738, 319, 795, 376), fill="#ffae80")

png = OUT / "icon.png"
ico = OUT / "icon.ico"
image.save(png)
image.save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(png)
print(ico)
