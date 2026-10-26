"""
构建提交附件压缩包

为什么不用 PowerShell 的 Compress-Archive：
  1. 它写入的条目分隔符是反斜杠（screenshots\\a.png），在 macOS / Linux 上解压会变成
     一个名字里带反斜杠的文件，而不是目录结构；
  2. 中文文件名没有置 UTF-8 标志位，跨平台解压会乱码。
zipfile 写入时统一用正斜杠，并在文件名非 ASCII 时设置 UTF-8 标志，两个问题都不会出现。

用法：python scripts/build-submission-zip.py
"""

import os
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DELIVERY = ROOT / "_delivery"
STAGE = DELIVERY / "pkg"
OUT = DELIVERY / "投资决策复盘_提交包.zip"

EXCLUDE_DIRS = {
    "node_modules", ".next", ".git", "data", ".tmp", ".workbuddy", "_delivery", ".vscode",
}
EXCLUDE_FILES = {
    ".env.local",
    "修改建议.md",
    "交付修补指令.md",
    "01_AI驱动的股票市场大势研判.md",
    "候选人附件_可配置投资监控与风险雷达.md",
    "11_投资决策复盘与学习.md",
}


def excluded(name: str) -> bool:
    if name.endswith(".genie") or name.endswith(".tsbuildinfo"):
        return True
    return name in EXCLUDE_FILES


def main() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE, ignore_errors=True)
    STAGE.mkdir(parents=True)

    # 1. 复制源码与文档
    for dirpath, dirnames, filenames in os.walk(ROOT):
        d = Path(dirpath)
        if d == ROOT:
            dirnames[:] = [x for x in dirnames if x not in EXCLUDE_DIRS]
        else:
            dirnames[:] = [x for x in dirnames if x not in EXCLUDE_DIRS]

        for fn in filenames:
            if excluded(fn):
                continue
            src = d / fn
            rel = src.relative_to(ROOT)
            dst = STAGE / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    # 2. 提交说明放最外层，截图放 screenshots/
    shutil.copy2(DELIVERY / "00_提交说明.md", STAGE / "00_提交说明.md")
    shots_dst = STAGE / "screenshots"
    shots_dst.mkdir(exist_ok=True)
    for png in sorted((DELIVERY / "shots").glob("*.png")):
        shutil.copy2(png, shots_dst / png.name)

    # 3. 打包：正斜杠 + UTF-8 文件名
    if OUT.exists():
        OUT.unlink()
    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for dirpath, _, filenames in os.walk(STAGE):
            for fn in sorted(filenames):
                full = Path(dirpath) / fn
                arc = full.relative_to(STAGE).as_posix()
                zf.write(full, arc)
                count += 1

    size = OUT.stat().st_size
    print(f"条目数: {count}")
    print(f"大小: {size} bytes ({size / 1024 / 1024:.2f} MB)")
    print(f"输出: {OUT}")

    # 4. 自检：确认关键条目与禁忌条目
    with zipfile.ZipFile(OUT) as zf:
        names = zf.namelist()
    checks = {
        "提交说明": "00_提交说明.md",
        "README": "README.md",
        "AI 记录": "docs/AI使用与验证记录.md",
        "测试说明": "docs/测试说明.md",
        "源码入口": "src/app/page.tsx",
        "截图": "screenshots/01-首页.png",
    }
    print("\n关键条目自检:")
    for label, path in checks.items():
        print(f"  {'✓' if path in names else '✗'} {label}: {path}")

    bad = [n for n in names if n.startswith("node_modules/") or "/.env.local" in n or n.endswith(".genie")]
    print(f"\n禁忌条目: {len(bad)} 个" if bad else "\n禁忌条目: 0 个")
    print(f"反斜杠条目: {sum(1 for n in names if chr(92) in n)} 个")


if __name__ == "__main__":
    main()
