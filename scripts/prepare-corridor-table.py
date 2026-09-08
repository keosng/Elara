"""Remove baked checkerboards and unwrap the supplied table art onto 3D parts.

Usage: python scripts/prepare-corridor-table.py COLOR_PNG SKETCH_PNG
Requires Pillow. Source coordinates refer to the supplied 2048px drawings.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, PngImagePlugin

ASSETS = Path(__file__).resolve().parents[1] / 'public' / 'assets'
# Pillow QUAD order: top-left, bottom-left, bottom-right, top-right.
PATCHES = {
    'top': ((768, 45, 534, 112, 1271, 234, 1522, 128), (768, 320)),
    'rim': ((531, 119, 533, 166, 1268, 292, 1270, 241), (768, 64)),
    'front': ((629, 188, 637, 357, 1166, 468, 1166, 279), (768, 256)),
    'side': ((1236, 301, 1265, 461, 1471, 350, 1479, 199), (384, 256)),
    'leg': ((1170, 480, 1180, 1083, 1213, 1097, 1228, 474), (96, 640)),
}

for state, source in zip(('painted', 'sketch'), sys.argv[1:]):
    original = Image.open(source).convert('RGBA')
    print(state, 'source alpha:', original.getchannel('A').getextrema())
    art = original.convert('RGB')
    # Ink outlines enclose the opaque paper, including white sketch interiors.
    boundary = art.convert('L').point(lambda p: 255 if p < 145 else 0)
    boundary = boundary.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    outside = boundary.copy()
    ImageDraw.floodfill(outside, (0, 0), 128)
    mask = outside.point(lambda p: 0 if p == 128 else 255)
    # All three leg gaps connect to the outside below the feet.
    for point in ((740, 600), (1030, 650), (1330, 680), (50, 50)):
        assert mask.getpixel(point) == 0, (state, 'background remains', point)
    for point in ((900, 160), (1000, 330), (1200, 700)):
        assert mask.getpixel(point) == 255, (state, 'lost table paper', point)
    output = original.copy()
    output.putalpha(mask)
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text('Source', str(Path(source).resolve()))
    metadata.add_text('Processing', 'Ink-bounded flood fill; 3D surfaces unwrapped from source illustration.')
    output.save(ASSETS / f'table-{state}-transparent.png', pnginfo=metadata)
    for part, (quad, size) in PATCHES.items():
        patch = art.transform(size, Image.Transform.QUAD, quad, Image.Resampling.BICUBIC)
        patch.save(ASSETS / f'table-{part}-{state}.png', pnginfo=metadata)
    print(state, 'leg gaps transparent; body opaque; 5 surface textures exported')
