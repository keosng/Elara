"""Normalize supplied alpha cutouts while preserving opaque paper interiors."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ASSETS = Path(__file__).resolve().parents[1] / 'public' / 'assets'
SOURCES = {
    'leaf': Path('C:/Users/hp/Downloads/n6dI2AX5ywMrM9FSlr0uY.png'),
    'frame': Path('C:/Users/hp/Downloads/jpmdxT1v1XFBAqz3m2YAe.png'),
}
for part, source in SOURCES.items():
    art = Image.open(source).convert('RGBA')
    mask = art.getchannel('A').point(lambda a: 255 if a > 100 else 0)
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    outside = mask.copy()
    ImageDraw.floodfill(outside, (0, 0), 128)
    mask = outside.point(lambda a: 0 if a == 128 else 255)
    assert mask.getpixel((510, 300)) == (255 if part == 'leaf' else 0)
    box = mask.getbbox()
    art.putalpha(mask.filter(ImageFilter.GaussianBlur(0.35)))
    art = art.crop(box)
    art.save(ASSETS / f'end-door-{part}-painted.png')
    print(part, box, art.size, 'alpha:', art.getchannel('A').getextrema())
