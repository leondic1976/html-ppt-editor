"""Structural PPTX check with python-pptx, for CI where PowerPoint is absent.

A pass means the package parses and holds the expected objects. It does not show that PowerPoint
renders it correctly: scripts/verify-powerpoint.ps1 covers that where PowerPoint exists.

Usage: python scripts/verify_pptx.py <file.pptx> [--slides N] [--notes TEXT]
"""
import argparse
import sys

from pptx import Presentation
from pptx.util import Emu


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("--slides", type=int)
    parser.add_argument("--notes")
    args = parser.parse_args()

    prs = Presentation(args.file)
    print(f"size {Emu(prs.slide_width).inches:.3f}x{Emu(prs.slide_height).inches:.3f}in, {len(prs.slides)} slides")
    notes = []
    for i, slide in enumerate(prs.slides, 1):
        kinds = {}
        for shape in slide.shapes:
            name = str(shape.shape_type).split(" ")[0]
            kinds[name] = kinds.get(name, 0) + 1
        print(f"  slide {i}: {kinds}")
        if slide.has_notes_slide:
            notes.append(slide.notes_slide.notes_text_frame.text)

    if args.slides is not None and len(prs.slides) != args.slides:
        print(f"expected {args.slides} slides", file=sys.stderr)
        return 1
    if args.notes and not any(args.notes in n for n in notes):
        print(f"expected notes containing {args.notes!r}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
