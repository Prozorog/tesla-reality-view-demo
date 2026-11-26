"""Measure the 5th, 50th and 95th greyscale percentiles and the mean R - B of the overhead view."""

import argparse
import math

from PIL import Image, ImageStat


def measure(path):
    with Image.open(path) as image:
        width, height = image.size
        crop = image.convert("RGB").crop(tuple(round(fraction * size) for fraction, size in (
            (0.12, width), (0.12, height), (0.72, width), (0.72, height),
        )))
        histogram = crop.convert("L").histogram()
        red, _, blue = ImageStat.Stat(crop).mean
    count = sum(histogram)
    values = []
    seen = 0
    for level, frequency in enumerate(histogram):
        seen += frequency
        while len(values) < 3 and seen >= math.ceil((0.05, 0.50, 0.95)[len(values)] * count):
            values.append(level)
    return (*values, red - blue)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("screenshots", nargs="+")
    for path in parser.parse_args().screenshots:
        low, median, high, warmth = measure(path)
        print(f"{path}  p05={low} median={median} p95={high} R-B={warmth:+.1f}")
