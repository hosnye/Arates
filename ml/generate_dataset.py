#!/usr/bin/env python3
"""
Synthetic domino dataset generator for the dedicated pip-counting model.

Why synthetic?  Domino tiles are perfectly renderable (a tile, a dividing line,
round pips 0-6).  We can produce tens of thousands of *perfectly labelled*
images for free, and — crucially — control the hard cases (rotation, glare,
occlusion, blank halves, the 5-vs-6 confusion) that a general LLM keeps getting
wrong.  This is what gets a dedicated model to ~98%+.

v2 — realism upgrade after real-phone testing showed false positives:
  * Tile colours are cream/ivory/pale-yellow (real tiles are rarely pure white).
  * Backgrounds include floral/cluttered fabric and blotchy textures (patterned
    carpets were triggering phantom pips), not just clean gradients.
  * Distractor dot-clusters drawn ON the background teach "a dot is only a pip
    when it's inside a tile".
  * ~12% of images are background-only negatives (model must output nothing).
  * Half the multi-tile images lay tiles touching in a ROW like a real hand —
    scattered-only layouts made the model miss halves of adjacent tiles.
  * Dimmer/warmer lighting + stronger blur to match indoor evening phone shots.

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

# Classes 0..6 are pip-half counts; class 7 is the whole tile (the anchor).
TILE_CLASS = 7


def rand_tile_color():
    # Real dominoes are rarely pure white — bias toward the cream/ivory/pale-yellow
    # tiles the scanner actually gets pointed at.
    if random.random() < 0.25:                       # white-ish minority
        base = random.randint(230, 255)
        return (base, base - random.randint(0, 10), base - random.randint(0, 18))
    r = random.randint(222, 248)
    g = r - random.randint(4, 18)
    b = g - random.randint(20, 70)
    return (r, g, max(130, b))


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
    # Pips on real tiles range from pure black to dark navy.
    shade = random.randint(10, 40)
    pip_col = (shade, shade, shade + random.randint(0, 25))
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


# Palettes sampled from the kinds of surfaces phones actually point at:
# patterned carpets, sofas, wood tables, green play cloth.
PALETTES = [
    [(94, 52, 46), (146, 90, 70), (196, 160, 124), (60, 34, 30), (170, 120, 96)],     # carpet reds/browns
    [(60, 62, 70), (110, 116, 128), (160, 160, 150), (40, 40, 46), (90, 80, 70)],     # grey sofa
    [(118, 86, 52), (150, 112, 70), (92, 64, 40), (180, 142, 96), (70, 48, 30)],      # wood table
    [(70, 90, 60), (120, 140, 100), (50, 60, 44), (160, 170, 130), (100, 110, 80)],   # green cloth
    [(140, 60, 60), (190, 150, 140), (90, 40, 44), (210, 190, 170), (120, 90, 86)],   # red floral
]


def gradient_bg(W, H):
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


def pattern_bg(W, H):
    """Floral/cluttered fabric — the hard real-world case (patterned carpets)."""
    pal = random.choice(PALETTES)
    bg = Image.new("RGB", (W, H), pal[0])
    d = ImageDraw.Draw(bg, "RGBA")
    for _ in range(random.randint(40, 120)):
        col = random.choice(pal) + (random.randint(70, 180),)
        cx, cy = random.randint(0, W), random.randint(0, H)
        rw, rh = random.randint(8, W // 4), random.randint(8, H // 4)
        if random.random() < 0.6:
            d.ellipse([cx - rw // 2, cy - rh // 2, cx + rw // 2, cy + rh // 2], fill=col)
        else:
            d.arc([cx - rw, cy - rh, cx + rw, cy + rh],
                  random.randint(0, 360), random.randint(0, 360),
                  fill=random.choice(pal), width=random.randint(2, 6))
    return bg.filter(ImageFilter.GaussianBlur(random.uniform(0.5, 2.0)))


def texture_bg(W, H):
    """Low-frequency blotchy texture (fabric weave / wood-grain-ish)."""
    pal = random.choice(PALETTES)
    c1 = np.array(pal[0], np.float32)
    c2 = np.array(pal[2], np.float32)
    small = np.random.rand(H // 8 + 1, W // 8 + 1).astype(np.float32)
    noise = np.kron(small, np.ones((8, 8), np.float32))[:H, :W]
    arr = c1[None, None] * (1 - noise[..., None]) + c2[None, None] * noise[..., None]
    img = Image.fromarray(arr.astype(np.uint8), "RGB")
    return img.filter(ImageFilter.GaussianBlur(random.uniform(1.0, 3.0)))


def add_distractor_dots(bg):
    """Dark round dots ON the background — teaches 'a dot is only a pip inside a tile'."""
    d = ImageDraw.Draw(bg)
    W, H = bg.size
    for _ in range(random.randint(0, 3)):            # clusters
        cx, cy = random.randint(0, W), random.randint(0, H)
        r = random.randint(4, 11)
        for _ in range(random.randint(2, 9)):
            x = cx + random.randint(-60, 60)
            y = cy + random.randint(-60, 60)
            shade = random.randint(15, 60)
            d.ellipse([x - r, y - r, x + r, y + r], fill=(shade, shade, shade + random.randint(0, 15)))


def make_background(W, H):
    roll = random.random()
    if roll < 0.30:
        bg = gradient_bg(W, H)
    elif roll < 0.72:
        bg = pattern_bg(W, H)
    else:
        bg = texture_bg(W, H)
    add_distractor_dots(bg)
    return bg


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
    if random.random() < 0.85:
        # down to 0.45 — evening indoor shots are much dimmer than clean renders
        img = ImageEnhance.Brightness(img).enhance(random.uniform(0.45, 1.25))
    if random.random() < 0.8:
        img = ImageEnhance.Contrast(img).enhance(random.uniform(0.75, 1.25))
    if random.random() < 0.5:
        img = ImageEnhance.Color(img).enhance(random.uniform(0.7, 1.35))
    if random.random() < 0.5:
        # warm indoor light cast (incandescent bulbs)
        warm = Image.new("RGB", img.size, (255, 180, 90))
        img = Image.blend(img, warm, random.uniform(0.04, 0.16))
    if random.random() < 0.5:
        img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.4, 2.0)))
    return img


def generate_one(idx, debug=False):
    W = random.randint(640, 1024)
    H = random.randint(512, 1024)
    canvas = make_background(W, H).convert("RGBA")
    labels = []  # (cls, cx, cy, bw, bh) normalised

    # ~12% pure negatives: background only — the model must learn to output nothing.
    n_tiles = 0 if random.random() < 0.12 else random.randint(1, 7)

    # Half the multi-tile images lay the tiles touching in a row like a real hand.
    row_layout = n_tiles >= 2 and random.random() < 0.5
    if row_layout:
        row_side = random.randint(70, 130)
        row_horizontal = random.random() < 0.2       # hands are usually vertical tiles side by side
        base_y = random.randint(int(H * 0.2), int(H * 0.55))
        x_cursor = random.randint(8, max(9, W - n_tiles * (row_side + 20) - 8))

    for _ in range(n_tiles):
        if row_layout:
            angle = random.uniform(-8, 8)
            horizontal = row_horizontal
            side = row_side
        else:
            angle = random.uniform(-45, 45)
            horizontal = random.random() < 0.5
            side = random.randint(60, 150)
        left, right = random.randint(0, 6), random.randint(0, 6)
        layer, halves = render_tile(side, left, right, horizontal)

        rot = layer.rotate(angle, expand=True, resample=Image.BICUBIC)
        RW, RH = rot.size
        if row_layout:
            pad = max(4, int(side * 0.12))
            px = x_cursor + random.randint(-3, 3)
            py = base_y + random.randint(-10, 10)
            # advance so tile faces touch / nearly touch like a held hand
            x_cursor += RW - 2 * pad + random.randint(0, 10)
            if px < 0 or py < 0 or px + RW >= W or py + RH >= H:
                continue
        else:
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

        # whole-tile box (class TILE_CLASS). At inference we keep only pip-halves that
        # sit INSIDE a detected tile — so the model anchors on the (background-invariant)
        # tile shape and ignores pip-lookalikes on carpet/wood/skin. This is what makes
        # results consistent across setups, not just on the surface it was trained on.
        pad = max(4, int(side * 0.12))
        tile_rect = (pad, pad, layer.width - pad, layer.height - pad)
        tx0, ty0, tx1, ty1 = rotated_bbox(tile_rect, layer.width, layer.height, angle, RW, RH)
        tx0, ty0, tx1, ty1 = tx0 + px, ty0 + py, tx1 + px, ty1 + py
        tx0, ty0 = max(0, tx0), max(0, ty0)
        tx1, ty1 = min(W, tx1), min(H, ty1)
        if tx1 - tx0 >= 8 and ty1 - ty0 >= 8:
            labels.append((TILE_CLASS, (tx0 + tx1) / 2 / W, (ty0 + ty1) / 2 / H,
                           (tx1 - tx0) / W, (ty1 - ty0) / H))

    img = canvas.convert("RGB")
    if n_tiles and random.random() < 0.45:
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
        f.write(f"  {TILE_CLASS}: 'tile'\n")
    print(f"Done. {args.num} images -> {args.out}\n  data.yaml: {data_yaml}")


if __name__ == "__main__":
    main()
