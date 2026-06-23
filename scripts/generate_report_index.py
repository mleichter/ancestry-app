#!/usr/bin/env python3
"""Generate a test-reports/index.html that links all available reports."""
import os
import re
from pathlib import Path
from datetime import datetime

REPORTS_DIR = Path(__file__).parent.parent / "test-reports"
REPORTS_DIR.mkdir(exist_ok=True)


def _count_from_html(path: Path) -> tuple[int, int]:
    """Parse passed/failed counts from pytest-html or junit XML."""
    try:
        text = path.read_text(errors="ignore")
        if path.suffix == ".html":
            passed = len(re.findall(r'class="passed"', text))
            failed = len(re.findall(r'class="failed"', text))
            return passed, failed
        elif path.suffix == ".xml":
            tests = int(re.search(r'tests="(\d+)"', text).group(1)) if re.search(r'tests="(\d+)"', text) else 0
            failures = int(re.search(r'failures="(\d+)"', text).group(1)) if re.search(r'failures="(\d+)"', text) else 0
            errors = int(re.search(r'errors="(\d+)"', text).group(1)) if re.search(r'errors="(\d+)"', text) else 0
            return tests - failures - errors, failures + errors
    except Exception:
        pass
    return 0, 0


reports = [
    ("Backend (pytest)", "backend.html"),
    ("Frontend (vitest)", "frontend-junit.xml"),
    ("E2E (Playwright)", "e2e.html"),
]

rows = []
total_pass = total_fail = 0
for label, filename in reports:
    path = REPORTS_DIR / filename
    if path.exists():
        p, f = _count_from_html(path)
        total_pass += p
        total_fail += f
        status = "✅ Pass" if f == 0 else f"❌ {f} failed"
        link = f'<a href="{filename}">{label}</a>'
        rows.append(f"<tr><td>{link}</td><td>{p}</td><td>{f}</td><td>{status}</td></tr>")
    else:
        rows.append(f"<tr><td>{label}</td><td colspan='3'><em>not run</em></td></tr>")

overall = "✅ All tests passing" if total_fail == 0 else f"❌ {total_fail} test(s) failed"
color = "#22c55e" if total_fail == 0 else "#ef4444"
timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Test Report — Stammbaum</title>
<style>
  body {{ font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }}
  h1 {{ color: #1e3a5f; }}
  .badge {{ display: inline-block; padding: 6px 14px; border-radius: 6px; color: white;
            background: {color}; font-weight: 600; font-size: 1.1rem; }}
  table {{ border-collapse: collapse; width: 100%; margin-top: 24px; }}
  th, td {{ padding: 10px 14px; border: 1px solid #e5e7eb; text-align: left; }}
  th {{ background: #f3f4f6; font-weight: 600; }}
  a {{ color: #4f46e5; }}
  .meta {{ color: #6b7280; font-size: 0.85rem; margin-top: 6px; }}
</style>
</head>
<body>
<h1>🌳 Stammbaum — Test Report</h1>
<div class="badge">{overall}</div>
<p class="meta">Generated: {timestamp} &nbsp;|&nbsp; {total_pass + total_fail} total tests</p>
<table>
  <thead><tr><th>Suite</th><th>Passed</th><th>Failed</th><th>Status</th></tr></thead>
  <tbody>{"".join(rows)}</tbody>
</table>
</body>
</html>"""

(REPORTS_DIR / "index.html").write_text(html)
print(f"Report written to {REPORTS_DIR}/index.html")
