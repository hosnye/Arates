#!/usr/bin/env python3
"""
Fold the real Roboflow domino photos into our YOLO training set.

Source: a Roboflow `yolov8` export of `dominos-counter` (155 real WhatsApp photos).
Two mismatches to bridge:
  1. Labels are 4-corner POLYGONS (oriented boxes) — we convert each to its
     axis-aligned bounding box (min/max of the points).
  2. Class indices are offset: their 0..5 == pip counts 1..6. Our scheme is
     class index == pip count (0..6 halves, 7 = whole tile). So our = their + 1.

Real images carry no blank-half (0) or whole-tile (7) labels — the synthetic
half of the dataset supplies those, so the tile-anchor still trains. We just add
the real 1..6 half supervision, which is what closes the synthetic-to-real gap.

Usage (run AFTER generate_dataset.py has written the synthetic set):
    python ml/merge_real.py --src ml/real --out ml/dataset
"""

import argparse
import os
import shutil


def poly_to_bbox(coords):
    """coords: flat list of normalised x,y,x,y,... -> (cx, cy, w, h)."""
    xs = coords[0::2]
    ys = coords[1::2]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    return (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0


def convert_label(src_path):
    out = []
    with open(src_path) as f:
        for line in f:
            parts = line.split()
            if len(parts) < 5:        # class + at least a box (4 nums)
                continue
            cls = int(float(parts[0]))
            coords = [float(v) for v in parts[1:]]
            if len(coords) == 4:               # already a YOLO box: cx cy w h
                cx, cy, w, h = coords
            else:                               # polygon (oriented box) -> aabb
                cx, cy, w, h = poly_to_bbox(coords)
            if w <= 0 or h <= 0:
                continue
            our_cls = cls + 1         # their 0..5 -> our pip count 1..6
            out.append(f"{our_cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="ml/real", help="Roboflow yolov8 export dir")
    ap.add_argument("--out", default="ml/dataset", help="our dataset dir to append into")
    ap.add_argument("--repeat", type=int, default=1,
                    help="oversample: write each real image N times (different names) so "
                         "155 real photos carry weight against thousands of synthetic. "
                         "YOLO re-augments each copy per epoch, so copies aren't wasted.")
    args = ap.parse_args()

    # their split -> our split. valid+test both become our val so we get a
    # real-image validation signal (an honest mAP on real photos).
    split_map = {"train": "train", "valid": "val", "test": "val"}
    counts = {"images": 0, "labels": 0, "boxes": 0}

    for src_split, dst_split in split_map.items():
        img_dir = os.path.join(args.src, src_split, "images")
        lbl_dir = os.path.join(args.src, src_split, "labels")
        if not os.path.isdir(img_dir):
            continue
        out_img = os.path.join(args.out, "images", dst_split)
        out_lbl = os.path.join(args.out, "labels", dst_split)
        os.makedirs(out_img, exist_ok=True)
        os.makedirs(out_lbl, exist_ok=True)

        # Oversample the train split only; keep val at 1x so its metrics stay honest.
        reps = args.repeat if dst_split == "train" else 1

        for img in os.listdir(img_dir):
            stem, ext = os.path.splitext(img)
            if ext.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            src_lbl = os.path.join(lbl_dir, stem + ".txt")
            lines = convert_label(src_lbl) if os.path.exists(src_lbl) else []
            for r in range(reps):
                # "real_" prefix guarantees no name clash with synthetic dom_***;
                # the _rN suffix gives each oversampled copy a distinct name.
                tag = "real_" + stem + (f"_r{r}" if reps > 1 else "")
                shutil.copy(os.path.join(img_dir, img), os.path.join(out_img, tag + ext))
                with open(os.path.join(out_lbl, tag + ".txt"), "w") as f:
                    f.write("\n".join(lines) + ("\n" if lines else ""))
                counts["images"] += 1
                counts["labels"] += 1 if lines else 0
                counts["boxes"] += len(lines)

    print(f"Merged {counts['images']} real images "
          f"({counts['boxes']} half-boxes) into {args.out}")


if __name__ == "__main__":
    main()
