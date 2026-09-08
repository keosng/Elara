"""Increase subtle paper fibers and grain while preserving the supplied tile."""
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

source = Path('public/assets/ceiling-paper.png')
output = Path('public/assets/ceiling-paper-textured.png')

with Image.open(source) as image:
    rgba = image.convert('RGBA')
    # Work in luminance so the paper stays neutral and does not become colorful.
    gray = ImageOps.grayscale(rgba)
    gray = ImageEnhance.Contrast(gray).enhance(1.75)
    gray = gray.filter(ImageFilter.UnsharpMask(radius=1.4, percent=120, threshold=2))
    # Keep the paper bright while making its fibers legible in the 3D material.
    gray = gray.point(lambda value: max(202, min(255, round(255 - (255 - value) * 0.88))))
    result = Image.merge('RGBA', (gray, gray, gray, rgba.getchannel('A')))
    result.save(output)
    assert result.size == image.size
    print(f'{output}: {result.size}, range={gray.getextrema()}')
