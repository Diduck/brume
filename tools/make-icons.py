#!/usr/bin/env python3
"""Génère les icônes de Brume sans aucune image source (tout est calculé).

- src/assets/trayTemplate.png (+ @2x) : flocon monochrome pour la barre des menus
- build/icon.icns                     : icône de l'application (ciel nocturne, aurore, flocon, neige)
"""
import os
import struct
import subprocess
import tempfile
import zlib

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def write_png(path, rgba):
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def seg_dist(px, py, ax, ay, bx, by):
    pax, pay, bax, bay = px - ax, py - ay, bx - ax, by - ay
    h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1)
    return np.hypot(pax - bax * h, pay - bay * h)


def snowflake_distance(x, y, radius):
    """Distance au flocon : 6 branches avec 2 paires de ramifications chacune."""
    d = np.full(x.shape, 1e9)
    for k in range(6):
        a = np.pi / 2 + k * np.pi / 3
        ca, sa = np.cos(a), np.sin(a)
        d = np.minimum(d, seg_dist(x, y, 0, 0, ca * radius, sa * radius))
        for t, length in ((0.45, 0.32), (0.72, 0.22)):
            bx, by = ca * radius * t, sa * radius * t
            for side in (-1, 1):
                b = a + side * np.pi / 4
                d = np.minimum(d, seg_dist(x, y, bx, by, bx + np.cos(b) * radius * length, by + np.sin(b) * radius * length))
    return d


def grid(size, ss):
    n = size * ss
    c = (np.arange(n) + 0.5) / ss
    return np.meshgrid(c, c)


def downsample(img, ss):
    n = img.shape[0] // ss
    return img.reshape(n, ss, n, ss, *img.shape[2:]).mean(axis=(1, 3))


def tray_icon(size):
    ss = 4
    x, y = grid(size, ss)
    cx = cy = size / 2
    d = snowflake_distance(x - cx, y - cy, size * 0.44)
    alpha = downsample((d < size * 0.055).astype(np.float64), ss)
    rgba = np.zeros((size, size, 4), np.uint8)
    rgba[..., 3] = np.round(alpha * 255).astype(np.uint8)
    return rgba


def app_icon(size=1024):
    ss = 2
    x, y = grid(size, ss)
    u, v = x / size, y / size
    # Fond : carré arrondi (gabarit macOS : 824 px sur 1024, rayon ~185).
    m, r = 100 / 1024, 185 / 1024
    qx = np.maximum(np.abs(u - 0.5) - (0.5 - m - r), 0)
    qy = np.maximum(np.abs(v - 0.5) - (0.5 - m - r), 0)
    inside = (np.hypot(qx, qy) <= r).astype(np.float64)

    top, bottom = np.array([0.04, 0.07, 0.16]), np.array([0.13, 0.2, 0.38])
    t = np.clip((v - m) / (1 - 2 * m), 0, 1)[..., None]
    col = top * (1 - t) + bottom * t

    # Voile d'aurore.
    band = 0.36 + 0.05 * np.sin(u * 9.0) + 0.03 * np.sin(u * 23.0 + 1.3)
    dy = band - v
    aur = np.exp(-np.maximum(dy, 0) / 0.11) * (dy > -0.01) * (0.55 + 0.45 * np.sin(u * 60.0) ** 2) * 0.5
    col = col + aur[..., None] * np.array([0.15, 0.85, 0.55])

    # Étoiles.
    rng = np.random.default_rng(7)
    for sx, sy, sr in zip(rng.uniform(0.15, 0.85, 26), rng.uniform(0.14, 0.5, 26), rng.uniform(0.002, 0.005, 26)):
        col = col + np.exp(-((u - sx) ** 2 + (v - sy) ** 2) / (sr * sr))[..., None] * 0.9

    # Flocon.
    d = snowflake_distance((u - 0.5) * size, (v - 0.47) * size, size * 0.24)
    flake = np.clip((size * 0.022 - d) / 2.0 + 0.5, 0, 1)
    col = col * (1 - flake[..., None]) + np.array([0.97, 0.98, 1.0]) * flake[..., None]

    # Neige en bas : une congère ondulée.
    snow_line = 0.80 - 0.035 * np.sin(u * 7.0 + 0.5) - 0.02 * np.sin(u * 15.0)
    snow = np.clip((v - snow_line) * size / 3.0, 0, 1)
    shade = np.clip((v - snow_line) * 6, 0, 1)[..., None]
    snow_col = np.array([0.98, 0.99, 1.0]) * (1 - shade * 0.25) + np.array([0.7, 0.78, 0.92]) * shade * 0.25
    col = col * (1 - snow[..., None]) + snow_col * snow[..., None]

    rgba = np.concatenate([np.clip(col, 0, 1), inside[..., None]], axis=-1)
    rgba = downsample(rgba, ss)
    rgba[..., :3] *= 1  # couleurs non prémultipliées (format PNG)
    return np.round(np.clip(rgba, 0, 1) * 255).astype(np.uint8)


def main():
    assets = os.path.join(ROOT, "src", "assets")
    os.makedirs(assets, exist_ok=True)
    write_png(os.path.join(assets, "trayTemplate.png"), tray_icon(18))
    write_png(os.path.join(assets, "trayTemplate@2x.png"), tray_icon(36))

    base = app_icon(1024)
    build = os.path.join(ROOT, "build")
    os.makedirs(build, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        master = os.path.join(tmp, "master.png")
        write_png(master, base)
        iconset = os.path.join(tmp, "icon.iconset")
        os.makedirs(iconset)
        for s in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                px = s * scale
                name = f"icon_{s}x{s}{'@2x' if scale == 2 else ''}.png"
                subprocess.run(["sips", "-z", str(px), str(px), master, "--out", os.path.join(iconset, name)], check=True, capture_output=True)
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(build, "icon.icns")], check=True)
        write_png(os.path.join(build, "icon.png"), base)
    print("icônes générées")


if __name__ == "__main__":
    main()
