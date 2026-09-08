"""Restore opaque door paper inside the artwork's ink outline, not its rectangle.

Run with Pillow. Source drawings and their layout stay unchanged; both colour
states share the sketch's silhouette so hover cannot expose the wall behind it.
"""
from pathlib import Path
from collections import deque
from PIL import Image, ImageDraw, ImageFilter

ASSETS = Path(__file__).resolve().parents[1] / 'public' / 'assets'

for name, box in [('door', (495, 48, 880, 748)),
                  ('door-frame', (470, 55, 905, 730))]:
    sketch = Image.open(ASSETS / f'{name}-sketch.png').convert('RGB')
    # Only the drawing's dark ink is a boundary. The baked checkerboard is lighter.
    ink = sketch.convert('L').point(lambda p: 255 if p < 120 else 0)
    region = Image.new('L', sketch.size)
    region.paste(ink.crop(box), box)
    region = region.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    outside = region.copy()
    ImageDraw.floodfill(outside, (0, 0), 128)
    filled = outside.point(lambda p: 0 if p == 128 else 255)

    # Drop isolated pencil/noise marks outside the connected frame/leaf contour.
    pixels = bytearray(filled.tobytes())
    width, height = filled.size
    largest = []
    for start in range(len(pixels)):
        if not pixels[start]:
            continue
        queue = deque([start])
        pixels[start] = 0
        component = []
        while queue:
            i = queue.popleft()
            component.append(i)
            x, y = i % width, i // width
            for j in (i-1 if x else -1, i+1 if x+1 < width else -1,
                      i-width if y else -1, i+width if y+1 < height else -1):
                if j >= 0 and pixels[j]:
                    pixels[j] = 0
                    queue.append(j)
        if len(component) > len(largest):
            largest = component
    alpha = bytearray(width * height)
    for i in largest:
        alpha[i] = 255
    mask = Image.frombytes('L', sketch.size, bytes(alpha))
    assert len(largest) > (50000 if name == 'door-frame' else 200000)
    for state in ('sketch', 'painted'):
        art = Image.open(ASSETS / f'{name}-{state}.png').convert('RGBA')
        art.putalpha(mask)
        art.save(ASSETS / f'{name}-{state}-solid.png')
    print(name, 'opaque pixels:', len(largest), 'bounds:', mask.getbbox())
