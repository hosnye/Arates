#!/usr/bin/env python3
"""
Synthetic domino dataset generator for the dedicated pip-counting model.

Why synthetic?  Domino tiles are perfectly renderable (a tile, a dividing line,
round pips 0-6).  We can produce tens of thousands of *perfectly labelled*
images for free, and — crucially — control the hard cases (rotation, glare,
occlusion, blank halves, the 5-vs-6 confusion) that a general LLM keeps getting
wrong.  This is what gets a dedicated model to ~98%+.

Label design — we detect each domino *half* as its own object whose class is the
pip count (0..6).  That means:
  * 7 classes, clean and balanced.
  * The hand total is simply the SUM of every detected half's class — no need to
    pair halves into tiles just to score.  (Pairing is only for the display.)

Output is standard YOLO format, ready for `ultralytics` training:

    ml/dataset/
      images/train/*.jpg   images/val/*.jpg
      labels/train/*.txt   labels/val/*.txt   (lines: "class cx cy w h", normalised)
      data.yaml

Usage:
    pip install -r ml/requirements.txt
    python ml/generate_dataset.py --num 8000 --out ml/dataset
    python ml/generate_dataset.py --num 24 --out ml/preview --debug   # boxes drawn on

Then train (see ml/README.md):
    yolo detect train data=ml/dataset/data.yaml model=yolo11n.pt imgsz=640 epochs=80
"""

import argparse
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

# Pip layout on a 3x3 grid inside one half-square (standard die faces).
G = {
    "TL": (0.27, 0.27), "TC": (0.5, 0.27), "TR": (0.73, 0.27),
    "ML": (0.27, 0.5),  "MC": (0.5, 0.5),  "MR": (0.73, 0.5),
    "BL": (0.27, 0.73), "BC": (0.5, 0.73), "BR": (0.73, 0.73),
}
PIP_LAYOUT = {
    0: [],
    1: ["MC"],
    2: ["TL", "BR"],
    3: ["TL", "MC", "BR"],
    4: ["TL", "TR", "BL", "BR"],
    5: ["TL", "TR", "MC", "BL", "BR"],
    6: ["TL", "TR", "ML", "MR", "BL", "BR"],
}


def rand_tile_color():
    base = random.randint(225, 255)
    # slight warm/cool tint so the model doesn't overfit to pure white
    return (base, base - random.randint(0, 12), base - random.randint(0, 20))


def draw_half(draw, ox, oy, side, value, pip_color):
    """Draw one half (value 0-6) into a `side`x`side` box at (ox, oy)."""
    r = max(2, int(side * 0.085))
    for key in PIP_LAYOUT[value]:
        gx, gy = G[key]
        cx, cy = ox + gx * side, oy + gy * side
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=pip_color)


def render_tile(side, left, right, horizontal):
    """
    Render one domino tile on its own transparent RGBA layer.
    Returns (layer, halves) where halves = [(value, (x0,y0,x1,y1)), ...] in layer coords.
    """
    pad = max(4, int(side * 0.12))
    if horizontal:
        w, h = side * 2, side
    else:
        w, h = side, side * 2
    W, H = w + pad * 2, h + pad * 2

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    tile_col = rand_tile_color()
    radius = int(side * 0.14)
    d.rounded_rectangle([pad, pad, pad + w, pad + h], radius=radius,
                        fill=tile_col, outline=(60, 60, 60), width=max(1, side // 60))

    line_col = (90, 90, 90)
    pip_col = (20, 20, 20)
    if horizontal:
        mx = pad + side
        d.line([mx, pad + side * 0.12, mx, pad + side * 0.88], fill=line_col, width=max(2, side // 40))
        halves = [
            (left, (pad, pad, pad + side, pad + side)),
            (right, (pad + side, pad, pad + 2 * side, pad + side)),
        ]
    else:
        my = pad + side
        d.line([pad + side * 0.12, my, pad + side * 0.88, my], fill=line_col, width=max(2, side // 40))
        halves = [
            (left, (pad, pad, pad + side, pad + side)),
            (right, (pad, pad + side, pad + side, pad + 2 * side)),
        ]

    for value, (x0, y0, x1, y1) in halves:
        draw_half(d, x0, y0, side, value, pip_col)

    return layer, halves


def transform_point(x, y, w, h, angle_deg, W, H):
    """Map a point in the un-rotated layer to coords after PIL rotate(angle, expand=True)."""
    th = math.radians(angle_deg)
    cos, sin = math.cos(th), math.sin(th)
    cx, cy = w / 2.0, h / 2.0
    dx, dy = x - cx, y - cy
    X = cos * dx + sin * dy + W / 2.0
    Y = -sin * dx + cos * dy + H / 2.0
    return X, Y


def rotated_bbox(box, w, h, angle_deg, W, H):
    x0, y0, x1, y1 = box
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    tp = [transform_point(px, py, w, h, angle_deg, W, H) for px, py in pts]
    xs = [p[0] for p in tp]
    ys = [p[1] for p in tp]
    return min(xs), min(ys), max(xs), max(ys)


def make_background(W, H):
    # vertical gradient between two random colours (vectorised with numpy)
    c1 = np.array([random.randint(30, 200) for _ in range(3)], dtype=np.float32)
    c2 = np.array([random.randint(30, 200) for _ in range(3)], dtype=np.float32)
    t = np.linspace(0.0, 1.0, H, dtype=np.float32)[:, None]          # (H,1)
    grad = (c1[None, :] * (1 - t) + c2[None, :] * t)                 # (H,3)
    arr = np.broadcast_to(grad[:, None, :], (H, W, 3)).copy()        # (H,W,3)
    # speckle noise so the model doesn't rely on flat backgrounds
    n = (W * H) // 1400
    ys = np.random.randint(0, H, n)
    xs = np.random.randint(0, W, n)
    arr[ys, xs] = np.random.randint(0, 256, (n, 1))
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def add_fingers(img, n):
    """Skin-tone rounded rects entering from edges — mild occlusion realism."""
    d = ImageDraw.Draw(img, "RGBA")
    W, H = img.size
    for _ in range(n):
        skin = (random.randint(180, 235), random.randint(140, 180), random.randint(110, 150), 255)
        fw = random.randint(W // 12, W // 6)
        if random.random() < 0.5:
            x = random.randint(0, W - fw)
            y0 = H - random.randint(0, H // 4)
            d.rounded_rectangle([x, y0, x + fw, H + 40], radius=fw // 2, fill=skin)
        else:
            x = random.randint(0, W - fw)
            y1 = random.randint(0, H // 4)
            d.rounded_rectangle([x, -40, x + fw, y1], radius=fw // 2, fill=skin)


def augment(img):
    if random.random() < 0.8:
        img = ImageEnhance.Brightness(img).enhance(random.uniform(0.65, 1.25))
    if random.random() < 0.8:
        img = ImageEnhance.Contrast(img).enhance(random.uniform(0.8, 1.25))
    if random.random() < 0.5:
        img = ImageEnhance.Color(img).enhance(random.uniform(0.7, 1.3))
    if random.random() < 0.35:
        img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.4, 1.4)))
    return img


def generate_one(idx, debug=False):
    W = random.randint(640, 1024)
    H = random.randint(512, 1024)
    canvas = make_background(W, H).convert("RGBA")

    n_tiles = random.randint(1, 7)
    labels = []  # (cls, cx, cy, bw, bh) normalised

    for _ in range(n_tiles):
        side = random.randint(70, 150)
        horizontal = random.random() < 0.5
        left, right = random.randint(0, 6), random.randint(0, 6)
        layer, halves = render_tile(side, left, right, horizontal)

        angle = random.uniform(-45, 45)
        rot = layer.rotate(angle, expand=True, resample=Image.BICUBIC)
        RW, RH = rot.size
        if RW >= W or RH >= H:
            continue
        px = random.randint(0, W - RW)
        py = random.randint(0, H - RH)
        canvas.alpha_composite(rot, (px, py))

        for value, box in halves:
            bx0, by0, bx1, by1 = rotated_bbox(box, layer.width, layer.height, angle, RW, RH)
            bx0, by0, bx1, by1 = bx0 + px, by0 + py, bx1 + px, by1 + py
            bx0, by0 = max(0, bx0), max(0, by0)
            bx1, by1 = min(W, bx1), min(H, by1)
            if bx1 - bx0 < 6 or by1 - by0 < 6:
                continue
            cx = (bx0 + bx1) / 2 / W
            cy = (by0 + by1) / 2 / H
            bw = (bx1 - bx0) / W
            bh = (by1 - by0) / H
            labels.append((value, cx, cy, bw, bh))

    img = canvas.convert("RGB")
    if random.random() < 0.4:
        add_fingers(img, random.randint(1, 2))
    img = augment(img)

    if debug:
        dd = ImageDraw.Draw(img)
        for cls, cx, cy, bw, bh in labels:
            x0 = (cx - bw / 2) * W; y0 = (cy - bh / 2) * H
            x1 = (cx + bw / 2) * W; y1 = (cy + bh / 2) * H
            dd.rectangle([x0, y0, x1, y1], outline=(255, 0, 0), width=2)
            dd.text((x0 + 2, y0 + 2), str(cls), fill=(255, 255, 0))

    return img, labels


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--num", type=int, default=4000, help="number of images")
    ap.add_argument("--out", default="ml/dataset")
    ap.add_argument("--val-split", type=float, default=0.12)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--debug", action="store_true", help="draw boxes on images (for visual check)")
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    for split in ("train", "val"):
        os.makedirs(os.path.join(args.out, "images", split), exist_ok=True)
        os.makedirs(os.path.join(args.out, "labels", split), exist_ok=True)

    for i in range(args.num):
        split = "val" if random.random() < args.val_split else "train"
        img, labels = generate_one(i, debug=args.debug)
        stem = f"dom_{i:06d}"
        img.save(os.path.join(args.out, "images", split, stem + ".jpg"), quality=90)
        with open(os.path.join(args.out, "labels", split, stem + ".txt"), "w") as f:
            for cls, cx, cy, bw, bh in labels:
                f.write(f"{cls} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}\n")
        if (i + 1) % 500 == 0:
            print(f"  generated {i + 1}/{args.num}")

    data_yaml = os.path.join(args.out, "data.yaml")
    with open(data_yaml, "w") as f:
        f.write(f"path: {os.path.abspath(args.out)}\n")
        f.write("train: images/train\n")
        f.write("val: images/val\n")
        f.write("names:\n")
        for v in range(7):
            f.write(f"  {v}: '{v}'\n")
    print(f"Done. {args.num} images -> {args.out}\n  data.yaml: {data_yaml}")


if __name__ == "__main__":
    main()
