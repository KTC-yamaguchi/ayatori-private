#!/usr/bin/env python3
"""Combine artifacts/{app_name}/{target}/*.md into a single styled HTML.

Self-contained: uses Python standard library only (no external deps).
Compatible with AYATORI Operating Principle 1.

Features:
- Minimal markdown→HTML converter (heading / list / table / code / blockquote / inline).
- Optional screenshot marker `<!-- screenshots: SCR-XXX -->` expands to a row of
  figures sourced from {target}/screenshots/**/{SCR-XXX}[--variant].<ext> with base64
  inline embed. Supported formats: .png, .jpg, .jpeg, .webp, .gif
- Auto-numbered chapter titles. Cover page + TOC.
- File order: --order CLI arg > alphanumeric (files starting with "_" are excluded).

Usage:
  python skills/35-md-to-html-export/refs/build-md-export.py --app-name <project_name> --target screens
  python skills/35-md-to-html-export/refs/build-md-export.py --app-name <project_name> --target requirements
  python skills/35-md-to-html-export/refs/build-md-export.py --app-name <project_name> --target screens --title "..."
"""
from __future__ import annotations
import argparse, base64, html, os, re, sys
from datetime import date
from pathlib import Path


# ── CSS ─────────────────────────────────────────────────────────────────────
BASE_CSS = """
@page { size: A4; margin: 18mm 16mm; }
body { font-family: -apple-system, "Hiragino Sans", "Yu Gothic", sans-serif; font-size: 10.5pt; line-height: 1.6; color: #222; }
h1 { font-size: 20pt; border-bottom: 3px solid #2563eb; padding-bottom: 6px; margin-top: 0; padding-top: 60px; page-break-before: always; }
h1:first-of-type { page-break-before: auto; padding-top: 0; }
h2 { font-size: 15pt; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-top: 24px; color: #1e40af; }
h3 { font-size: 12.5pt; margin-top: 18px; color: #374151; }
h4 { font-size: 11pt; margin-top: 14px; color: #4b5563; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f3f4f6; font-weight: 600; }
tr:nth-child(even) td { background: #fafafa; }
code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-family: "SF Mono", Menlo, monospace; font-size: 9.5pt; }
pre { background: #1f2937; color: #e5e7eb; padding: 10px 12px; border-radius: 5px; overflow-x: auto; font-size: 9pt; }
pre code { background: none; color: inherit; padding: 0; }
ul, ol { margin: 6px 0 10px 22px; }
li { margin: 3px 0; }
blockquote { border-left: 4px solid #fbbf24; background: #fffbeb; padding: 6px 12px; margin: 10px 0; }
hr { border: none; border-top: 1px dashed #d1d5db; margin: 18px 0; }
a { color: #2563eb; text-decoration: none; }
strong { color: #111; }
.toc { background: #f9fafb; border: 1px solid #e5e7eb; padding: 12px 18px; border-radius: 6px; }
.toc h2 { border: none; margin-top: 0; }
.cover { text-align: center; padding: 80px 0 40px 0; page-break-after: always; }
.cover h1 { font-size: 32pt; border: none; padding: 0; }
.cover .subtitle { font-size: 14pt; color: #6b7280; margin-top: 12px; }
.cover .meta { margin-top: 60px; font-size: 11pt; color: #4b5563; }

.screenshot-row { display: flex; column-gap: 4%; row-gap: 32px; margin: 14px 0 18px 0; align-items: flex-start; flex-wrap: wrap; }
.screenshot-row figure { flex: 0 0 30%; margin: 0; text-align: center; }
.screenshot-row.cols-1 figure { flex: 0 0 60%; }
.screenshot-row.cols-2 figure { flex: 0 0 47%; }
.screenshot-row.cols-3 figure { flex: 0 0 30%; }
.screenshot-row.cols-4 figure { flex: 0 0 22%; }
.screenshot-row img { width: 100%; max-height: 600px; object-fit: contain; border: 1px solid #d1d5db; border-radius: 4px; background: #fafafa; }
.screenshot-row figcaption { font-size: 9pt; color: #6b7280; margin-top: 4px; }
.screenshot-row figure.empty { background: repeating-linear-gradient(45deg, #f9fafb, #f9fafb 8px, #f3f4f6 8px, #f3f4f6 16px); min-height: 240px; border: 1px dashed #d1d5db; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 9pt; padding: 12px; }
"""


# ── Markdown → HTML (stdlib only) ──────────────────────────────────────────
def md_to_html(md: str) -> str:
    lines = md.split("\n")
    out: list[str] = []
    in_code = False
    in_table = False
    table_rows: list[list[str]] = []
    in_list: str | None = None
    in_blockquote = False
    para: list[str] = []

    def inline(text: str) -> str:
        text = html.escape(text, quote=False)
        text = re.sub(r"`([^`]+)`", lambda m: f"<code>{m.group(1)}</code>", text)
        # URL は quote=True で再エスケープして href 属性の breakout を防ぐ (XSS 対策)
        text = re.sub(
            r"\[([^\]]+)\]\(([^)]+)\)",
            lambda m: f'<a href="{html.escape(m.group(2), quote=True)}">{m.group(1)}</a>',
            text,
        )
        text = re.sub(r"\*\*([^*]+)\*\*", lambda m: f"<strong>{m.group(1)}</strong>", text)
        return text

    def flush_para():
        if para:
            out.append(f"<p>{inline(' '.join(para))}</p>")
            para.clear()

    def flush_list():
        nonlocal in_list
        if in_list:
            out.append(f"</{in_list}>")
            in_list = None

    def flush_blockquote():
        nonlocal in_blockquote
        if in_blockquote:
            out.append("</blockquote>")
            in_blockquote = False

    def flush_table():
        nonlocal in_table, table_rows
        if in_table and table_rows:
            out.append("<table>")
            header = table_rows[0]
            out.append("<thead><tr>" + "".join(f"<th>{inline(c.strip())}</th>" for c in header) + "</tr></thead>")
            out.append("<tbody>")
            for row in table_rows[2:]:
                out.append("<tr>" + "".join(f"<td>{inline(c.strip())}</td>" for c in row) + "</tr>")
            out.append("</tbody></table>")
        in_table = False
        table_rows = []

    i = 0
    while i < len(lines):
        ln = lines[i]
        s = ln.rstrip()

        if s.startswith("```"):
            flush_para(); flush_list(); flush_blockquote(); flush_table()
            if not in_code:
                out.append("<pre><code>"); in_code = True
            else:
                out.append("</code></pre>"); in_code = False
            i += 1; continue
        if in_code:
            out.append(html.escape(ln, quote=False))
            i += 1; continue

        if s.startswith("|") and s.endswith("|") and "|" in s[1:-1]:
            flush_para(); flush_list(); flush_blockquote()
            cells = [c for c in s.strip("|").split("|")]
            if not in_table:
                in_table = True; table_rows = [cells]
            else:
                table_rows.append(cells)
            i += 1; continue
        elif in_table:
            flush_table()

        m = re.match(r"^(#{1,4})\s+(.+)$", s)
        if m:
            flush_para(); flush_list(); flush_blockquote()
            level = len(m.group(1))
            out.append(f"<h{level}>{inline(m.group(2))}</h{level}>")
            i += 1; continue

        if re.match(r"^-{3,}\s*$", s):
            flush_para(); flush_list(); flush_blockquote()
            out.append("<hr/>")
            i += 1; continue

        if s.startswith("> "):
            flush_para(); flush_list()
            if not in_blockquote:
                out.append("<blockquote>"); in_blockquote = True
            out.append(f"<p>{inline(s[2:])}</p>")
            i += 1; continue
        elif in_blockquote and not s.startswith(">"):
            flush_blockquote()

        m = re.match(r"^(\s*)[-*]\s+(.+)$", ln)
        if m:
            flush_para()
            if in_list != "ul":
                flush_list(); out.append("<ul>"); in_list = "ul"
            out.append(f"<li>{inline(m.group(2))}</li>")
            i += 1; continue

        m = re.match(r"^(\s*)\d+\.\s+(.+)$", ln)
        if m:
            flush_para()
            if in_list != "ol":
                flush_list(); out.append("<ol>"); in_list = "ol"
            out.append(f"<li>{inline(m.group(2))}</li>")
            i += 1; continue

        if not s.strip():
            flush_para(); flush_list()
            i += 1; continue

        para.append(s.strip())
        i += 1

    flush_para(); flush_list(); flush_blockquote(); flush_table()
    if in_code:
        out.append("</code></pre>")
    return "\n".join(out)


# ── Screenshot marker expansion ─────────────────────────────────────────────
SCREENSHOT_MARKER = re.compile(r"<p>&lt;!--\s*screenshots:\s*([A-Z0-9\-]+)(:none)?\s*--&gt;</p>")

# Supported image formats for screenshot embedding.
IMG_EXTENSIONS: tuple[str, ...] = (".png", ".jpg", ".jpeg", ".webp", ".gif")

# MIME type map for base64 data URI construction.
MIME_TYPES: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# Priority hints for variant ordering. Listed variants come first in this order;
# any other variant falls back to priority 50 (alphabetical sort).
# Extend per project if you have a fixed A/B convention.
VARIANT_PRIORITY: dict[str, int] = {
    # Default is empty — alphabetical order for all variants.
    # Example: {"control": 0, "intervention": 1} for A/B testing
}


def _slot(abs_path: Path, caption: str) -> str:
    b64 = base64.b64encode(abs_path.read_bytes()).decode("ascii")
    mime = MIME_TYPES.get(abs_path.suffix.lower(), "image/png")
    url = f"data:{mime};base64,{b64}"
    cap_html = f'<figcaption>{html.escape(caption)}</figcaption>' if caption else ''
    return f'<figure><img src="{url}" alt="{html.escape(caption)}"/>{cap_html}</figure>'


def _empty_slot(label: str = "スクリーンショットなし") -> str:
    return f'<figure class="empty">{html.escape(label)}</figure>'


def _discover_variants(shots_dir: Path, screen_id: str) -> list[tuple[str, Path]]:
    """Recursively find {screen_id}[--<variant>].<ext> under shots_dir.

    Supported extensions: .png, .jpg, .jpeg, .webp, .gif (case-insensitive).
    When multiple formats exist for the same variant, PNG is preferred;
    otherwise the first match in alphanumeric order is used.
    """
    if not shots_dir.is_dir():
        return []
    pattern = re.compile(rf"^{re.escape(screen_id)}(?:--([^.]+))?(\.[^.]+)$")
    found: list[tuple[str, Path]] = []
    seen_variants: set[str] = set()
    for img in sorted(shots_dir.rglob("*")):
        if img.suffix.lower() not in IMG_EXTENSIONS:
            continue
        m = pattern.match(img.name)
        if not m:
            continue
        variant = m.group(1) or ""
        # Prefer PNG when multiple formats exist for the same variant
        if variant in seen_variants:
            existing = next(p for v, p in found if v == variant)
            if existing.suffix.lower() == ".png":
                continue  # keep existing PNG
            found = [(v, p) for v, p in found if v != variant]
        seen_variants.add(variant)
        found.append((variant, img))
    found.sort(key=lambda item: (VARIANT_PRIORITY.get(item[0], 50), item[0]))
    return found


def expand_screenshots(html_out: str, shots_dir: Path) -> str:
    def repl(m: re.Match) -> str:
        screen_id = m.group(1)
        if m.group(2):  # :none
            return f'<div class="screenshot-row cols-1">{_empty_slot()}</div>'
        variants = _discover_variants(shots_dir, screen_id)
        if not variants:
            return f'<div class="screenshot-row cols-1">{_empty_slot()}</div>'
        slots = [_slot(p, suffix) for suffix, p in variants]
        cols = min(len(slots), 4)
        return f'<div class="screenshot-row cols-{cols}">{"".join(slots)}</div>'
    return SCREENSHOT_MARKER.sub(repl, html_out)


# ── File ordering ──────────────────────────────────────────────────────────
def determine_order(src_dir: Path, explicit: list[str] | None) -> list[str]:
    """Decide MD file order: explicit > alphanumeric (excluding _ prefixed files).

    Stateless by design: this script never reads/writes pipeline-state.json,
    keeping it free of additional concerns per the artifact responsibility split.
    """
    if explicit:
        return explicit
    return sorted(
        f.name for f in src_dir.iterdir()
        if f.is_file() and f.suffix == ".md" and not f.name.startswith("_")
    )


# ── Main ────────────────────────────────────────────────────────────────────
def build(app_root: Path, target: str, title: str, order: list[str] | None) -> Path:
    src_dir = app_root / target
    shots_dir = src_dir / "screenshots"
    out_path = app_root / f"{target}.html"

    if not src_dir.is_dir():
        raise SystemExit(f"ERROR: source directory not found: {src_dir}")

    files = determine_order(src_dir, order)
    if not files:
        raise SystemExit(f"ERROR: no .md files found in {src_dir}")

    sections: list[str] = []
    toc: list[tuple[str, str]] = []
    chapter = 0
    for f in files:
        path = src_dir / f
        if not path.exists():
            print(f"WARN: missing {f}", file=sys.stderr); continue
        md = path.read_text(encoding="utf-8")
        m = re.search(r"^#\s+(.+)$", md, re.M)
        chapter += 1
        chapter_title = (m.group(1).strip() if m else f)
        anchor = f.replace(".md", "")
        toc.append((anchor, f"{chapter}. {chapter_title}"))
        body = expand_screenshots(md_to_html(md), shots_dir)
        body = re.sub(r"<h1>", f"<h1>{chapter}. ", body, count=1)
        sections.append(f'<section id="{anchor}"><br><br><br>\n{body}</section>')

    toc_html = (
        '<br><br><br>\n<div class="toc"><h2>目次</h2><ol>'
        + "".join(f'<li><a href="#{a}">{html.escape(t)}</a></li>' for a, t in toc)
        + "</ol></div>"
    )

    cover = f"""
    <div class="cover">
      <h1>{html.escape(title)}</h1>
      <div class="subtitle">{html.escape(app_root.name)}</div>
      <div class="meta">
        生成日: {date.today().isoformat()}<br/>
        対象: 全 {chapter} 章<br/>
        生成元: AYATORI パイプライン /ayatori-export
      </div>
    </div>
    """

    doc = (
        '<!DOCTYPE html>\n'
        f'<html lang="ja"><head><meta charset="utf-8"><title>{html.escape(title)}</title>\n'
        f'<style>{BASE_CSS}</style></head><body>\n'
        f'{cover}\n{toc_html}\n{"".join(sections)}\n</body></html>'
    )

    out_path.write_text(doc, encoding="utf-8")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build self-contained HTML from artifacts/{app_name}/{target}/*.md")
    parser.add_argument("--app-name", required=True, help="Project name under artifacts/")
    parser.add_argument("--target", required=True, choices=["screens", "requirements"], help="Source subdirectory")
    parser.add_argument("--title", default=None, help="Cover page title (default: auto)")
    parser.add_argument("--order", nargs="*", help="Explicit file order (filenames). Defaults to alphanumeric order when omitted")
    parser.add_argument("--artifacts-root", default=None, help="Override artifacts root (default: <repo>/artifacts)")
    args = parser.parse_args()

    # File location: skills/35-md-to-html-export/refs/build-md-export.py
    # parents: [0]=refs, [1]=35-md-to-html-export, [2]=skills, [3]=repo root
    repo_root = Path(__file__).resolve().parents[3]
    artifacts_root = Path(args.artifacts_root) if args.artifacts_root else repo_root / "artifacts"
    app_root = artifacts_root / args.app_name

    if not app_root.is_dir():
        raise SystemExit(f"ERROR: project directory not found: {app_root}")

    default_titles = {"screens": "画面定義書", "requirements": "要件定義書"}
    title = args.title or f"{args.app_name} {default_titles[args.target]}"

    out = build(app_root, args.target, title, args.order)
    print(f"HTML written: {out}")
    print(f"  ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
