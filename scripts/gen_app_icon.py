"""生成 TT Calendar 应用图标。

原图标是「纯黑日历字形 + 全透明底」，在深色任务栏上直接隐身（黑对黑）。
这里给它补一层白色圆角矩形底板，字形沿用原图（直接取 alpha 通道），
小尺寸单独画简化版，避免 16/32 上糊成黑块。

用法：
    py -3.10 scripts/gen_app_icon.py

输出写入 frontend/src-tauri/icons/，并留一份 1024 源图 source.png。
"""
from __future__ import annotations

import io
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "frontend" / "src-tauri" / "icons"
# 字形单独存一份：icon.png 会被本脚本覆盖，不能反复拿它当来源，
# 否则第二次运行就是「白底叠白底」。
GLYPH = ICONS / "glyph.png"          # 纯字形（透明底），生成一次后固定
LEGACY_ICON = ICONS / "icon.png"     # 首次运行用来提取字形
SOURCE_OUT = ICONS / "source.png"    # 1024 源图，供以后重新生成

SIZE = 1024
SS = 4                              # 超采样倍数，缩小时靠 LANCZOS 平滑
INK = (17, 24, 39)                  # --cal-ink #111827
INSET = 0.035                       # 底板四周留白（相对画布）
RADIUS = 0.225                      # 圆角半径（相对画布）
GLYPH_RATIO = 0.63                  # 字形宽度占底板内区域的比例


def _rounded_mask(w: int, radius: int, inset: float = INSET) -> Image.Image:
    m = Image.new("L", (w, w), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [int(w * inset), int(w * inset), w - int(w * inset), w - int(w * inset)],
        radius=radius,
        fill=255,
    )
    return m


def _plate(w: int, inset: float = INSET, radius_r: float = RADIUS) -> Image.Image:
    """白色圆角底板：上白下浅灰的极轻渐变 + 一圈淡描边。

    纯白底板放在浅色任务栏（#F3F3F3）上会没有边界，所以描边不能省；
    渐变只为了让深色任务栏上的白块不那么「死」，幅度刻意压到几乎看不出。

    小尺寸会传更小的 inset / 圆角：16px 上 3.5% 的留白只有半个像素，
    白白吃掉可读面积，不如让底板铺满。
    """
    layer = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    top = int(w * inset)
    bottom = w - top
    for y in range(top, bottom):
        t = (y - top) / max(1, bottom - top)
        d.line(
            [(top, y), (bottom, y)],
            fill=(255, int(255 - 17 * t), int(255 - 12 * t), 255),
        )
    layer.putalpha(_rounded_mask(w, int(w * radius_r), inset))

    stroke = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    ImageDraw.Draw(stroke).rounded_rectangle(
        [top, top, bottom, bottom],
        radius=int(w * radius_r),
        outline=(*INK, 48),
        width=max(2, int(w * 0.0035)),
    )
    return Image.alpha_composite(layer, stroke)


def _glyph(w: int) -> Image.Image | None:
    """字形 alpha 当遮罩，重新上色成 ink。"""
    src = GLYPH if GLYPH.exists() else LEGACY_ICON
    if not src.exists():
        return None
    g = Image.open(src).convert("RGBA")
    bbox = g.getbbox()
    if bbox:
        g = g.crop(bbox)
    if src == LEGACY_ICON:
        # 首次运行：把纯字形留存下来，之后都读它
        g.save(GLYPH)
    inner = int(w * (1 - 2 * INSET))
    target = int(inner * GLYPH_RATIO)
    ratio = target / g.width
    g = g.resize((target, max(1, int(g.height * ratio))), Image.LANCZOS)
    ink = Image.new("RGBA", g.size, (*INK, 255))
    ink.putalpha(g.getchannel("A"))
    return ink


def render(size: int, simple: bool = False) -> Image.Image:
    """渲染一张图。

    simple=True 时不用旧字形（小尺寸下 3×2 的方格会糊掉），改画粗一点的
    日历轮廓 + 两条横杠，保证 16px 还能认出是日历。
    """
    w = size * SS
    # 小尺寸让底板铺满画布，大尺寸留 3.5% 呼吸
    tight = size <= 32
    canvas = _plate(w, inset=0.012 if tight else INSET, radius_r=0.20 if tight else RADIUS)

    if simple:
        d = ImageDraw.Draw(canvas)
        pad = int(w * 0.20)
        bw = max(3, int(w * 0.062))
        box = [pad, pad + int(w * 0.05), w - pad, w - pad - int(w * 0.02)]
        radius = int(w * 0.07)

        # 两个挂环：日历的招牌特征，小尺寸全靠它认出来。
        # 上一版省掉了这一步，16~32px 看起来完全像一张「文档」。
        ring_w = max(3, int(w * 0.05))
        for fx in (0.30, 0.70):
            cx = box[0] + int((box[2] - box[0]) * fx)
            d.rounded_rectangle(
                [cx - ring_w, box[1] - int(w * 0.072), cx + ring_w, box[1] + int(w * 0.05)],
                radius=ring_w,
                fill=(*INK, 255),
            )

        d.rounded_rectangle(box, radius=radius, outline=(*INK, 255), width=bw)

        # 顶部实心 header
        hh = int(w * 0.10)
        d.rounded_rectangle([box[0], box[1], box[2], box[1] + hh], radius=radius, fill=(*INK, 255))
        d.rectangle([box[0], box[1] + hh // 2, box[2], box[1] + hh], fill=(*INK, 255))

        # 内部小方块：16px 只放一个，24 放一行两个，32 放 2×2。
        # 位置按 box 内的中心百分比算，别再拿「左边缘比例」凑，否则整体会偏左。
        sq = max(3, int(w * 0.085))
        area_top = box[1] + hh
        area_h = box[3] - area_top
        row_fracs = (0.32, 0.72) if size >= 32 else (0.52,)
        col_fracs = (0.5,) if size < 24 else (0.30, 0.70)
        bw_box = box[2] - box[0]
        for fy in row_fracs:
            cy = area_top + int(area_h * fy)
            for fx in col_fracs:
                cx = box[0] + int(bw_box * fx)
                d.rounded_rectangle(
                    [cx - sq // 2, cy - sq // 2, cx + sq // 2, cy + sq // 2],
                    radius=max(1, sq // 4),
                    fill=(*INK, 255),
                )
    else:
        g = _glyph(w)
        if g is not None:
            canvas.alpha_composite(g, ((w - g.width) // 2, (w - g.height) // 2))

    return canvas.resize((size, size), Image.LANCZOS)


def _dib(im: Image.Image) -> bytes:
    """把 RGBA 图编码成 ICO 用的 DIB（32bpp BGRA + AND 掩码）。

    PIL 的 ico 保存只会从单张图缩放，16/32 档拿到的就是「真字形缩成一小坨」，
    正好丢掉简化画法。所以小档必须自己逐张渲染、自己编码。
    """
    w, h = im.size
    px = im.convert("RGBA")
    header = struct.pack(
        "<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, w * h * 4, 0, 0, 0, 0
    )
    rows = []
    for y in range(h - 1, -1, -1):  # DIB 自下而上
        row = bytearray()
        for x in range(w):
            r, g, b, a = px.getpixel((x, y))
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    # AND 掩码：1 = 透明（保留背景），0 = 不透明。必须按 alpha 逐像素生成。
    #
    # 之前这里图省事写成全 0，等于声明「整张图都不透明」。PIL 读 ICO 时优先用
    # alpha 通道，所以文件看起来完全正常；但 Windows 在小尺寸（任务栏 16/24px）
    # 会退回掩码路径，于是圆角外那圈 (0,0,0,0) 被当成不透明的黑色画出来——白底板
    # 直接变成黑块。这个只有贴到真任务栏上才看得见。
    stride = ((w + 31) // 32) * 4
    mask_rows = []
    for y in range(h - 1, -1, -1):  # 掩码同样是自下而上
        bits = bytearray(stride)
        for x in range(w):
            if px.getpixel((x, y))[3] < 128:
                bits[x // 8] |= 0x80 >> (x % 8)
        mask_rows.append(bytes(bits))
    return header + b"".join(rows) + b"".join(mask_rows)


def write_ico(path: Path, images: list[tuple[int, Image.Image]]) -> None:
    """写多档 ICO：>=256 用 PNG 压缩，小档用 DIB（兼容性更好）。"""
    blobs: list[tuple[int, bytes]] = []
    for size, im in sorted(images, key=lambda p: p[0]):
        if size >= 256:
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            blobs.append((size, buf.getvalue()))
        else:
            blobs.append((size, _dib(im)))

    offset = 6 + 16 * len(blobs)
    entries = bytearray()
    payload = bytearray()
    for size, data in blobs:
        dim = 0 if size >= 256 else size
        entries += struct.pack(
            "<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset
        )
        offset += len(data)
        payload += data

    path.write_bytes(
        struct.pack("<HHH", 0, 1, len(blobs)) + bytes(entries) + bytes(payload)
    )


def main() -> int:
    if not (GLYPH.exists() or LEGACY_ICON.exists()):
        print(f"缺少字形来源：{GLYPH} / {LEGACY_ICON}", file=sys.stderr)
        return 1

    master = render(SIZE)
    master.save(SOURCE_OUT)

    # tauri.conf.json 里 bundle.icon 引用的 + 常用尺寸
    targets = {
        "icon.png": 512,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "64x64.png": 64,
        "32x32.png": 32,
    }
    for name, size in targets.items():
        render(size, simple=size < 64).save(ICONS / name)

    # Windows 磁贴 / 商店图：不留透明边，整块铺满
    for name, size in {
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }.items():
        render(size, simple=size < 64).save(ICONS / name)

    # .ico：逐档渲染（小档走简化画法），不要交给 PIL 从单图缩放
    write_ico(
        ICONS / "icon.ico",
        [(s, render(s, simple=s < 64)) for s in (16, 24, 32, 48, 64, 128, 256)],
    )

    print(f"已生成 {SOURCE_OUT.name} 与 {len(targets) + 10} 个尺寸 + icon.ico")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
