from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
ASSETS=Path(__file__).resolve().parents[1]/'public'/'assets'
for part in ('frame','leaf'):
    im=Image.open(ASSETS/f'end-door-{part}-sketch-source.png').convert('RGBA')
    ink=im.convert('L').point(lambda p:255 if p<125 else 0).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    outside=ink.copy(); ImageDraw.floodfill(outside,(0,0),128)
    mask=outside.point(lambda p:0 if p==128 else 255)
    box=mask.getbbox(); im.putalpha(mask.filter(ImageFilter.GaussianBlur(.35))); im.crop(box).save(ASSETS/f'end-door-{part}-sketch.png')
    print(part,box)
