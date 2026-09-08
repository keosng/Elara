"""Desaturate and soften a wall tile without moving or redrawing its pixels."""
import argparse
from pathlib import Path

from PIL import Image, ImageOps

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--strength', type=float, default=0.5)
args = parser.parse_args()
if not 0 <= args.strength <= 1:
    parser.error('--strength must be between 0 and 1')

with Image.open(args.source) as source:
    rgba = source.convert('RGBA')
    gray = ImageOps.grayscale(rgba)
    softened = gray.point(lambda value: round(255 - (255 - value) * args.strength))
    result = Image.merge('RGBA', (softened, softened, softened, rgba.getchannel('A')))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.output)
    assert result.size == source.size
    assert result.getchannel('R').tobytes() == result.getchannel('G').tobytes()
    assert result.getchannel('G').tobytes() == result.getchannel('B').tobytes()
    print(f'{args.output}: {result.width}x{result.height}, grayscale range {softened.getextrema()}')
