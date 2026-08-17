#!/usr/bin/env bash
# Build docs/greek-prose-composition.pdf from docs/greek-prose-composition.md.
#
# Pipeline: pandoc (markdown -> HTML) -> print stylesheet -> headless Chromium.
# Typeface: Gentium Book Plus (SIL OFL), fetched into tools/cache/ on first run.
#
# Usage: tools/build-composition-pdf.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/greek-prose-composition.md"
OUT="$ROOT/docs/greek-prose-composition.pdf"
CACHE="$ROOT/tools/cache"
FONT_DIR="$CACHE/gentium/GentiumPlus-6.200"
GENTIUM_URL="https://software.sil.org/downloads/r/gentium/GentiumPlus-6.200.zip"

for dep in pandoc chromium curl unzip; do
  command -v "$dep" >/dev/null || { echo "missing dependency: $dep" >&2; exit 1; }
done

if [ ! -f "$FONT_DIR/GentiumBookPlus-Regular.ttf" ]; then
  echo "fetching Gentium Plus into tools/cache/ ..."
  mkdir -p "$CACHE"
  curl -sL -o "$CACHE/gentium.zip" "$GENTIUM_URL"
  unzip -o -q "$CACHE/gentium.zip" "*.ttf" -d "$CACHE/gentium"
  rm "$CACHE/gentium.zip"
fi

BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

pandoc "$SRC" -f gfm+smart -t html -o "$BUILD/body.html"

# The Drill/Lookup pointer paragraphs are set as apparatus, not body text.
sed -i -E 's|<p><strong>(Drill\|Lookup):</strong>|<p class="refs"><strong>\1:</strong>|g' "$BUILD/body.html"

cat > "$BUILD/print.html" <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Greek prose composition — a working manual</title>
<style>
@font-face { font-family: 'Gentium Book Plus'; font-weight: 400; font-style: normal;
  src: url('file://$FONT_DIR/GentiumBookPlus-Regular.ttf'); }
@font-face { font-family: 'Gentium Book Plus'; font-weight: 400; font-style: italic;
  src: url('file://$FONT_DIR/GentiumBookPlus-Italic.ttf'); }
@font-face { font-family: 'Gentium Book Plus'; font-weight: 700; font-style: normal;
  src: url('file://$FONT_DIR/GentiumBookPlus-Bold.ttf'); }
@font-face { font-family: 'Gentium Book Plus'; font-weight: 700; font-style: italic;
  src: url('file://$FONT_DIR/GentiumBookPlus-BoldItalic.ttf'); }
@page {
  size: A4;
  margin: 24mm 21mm 26mm 21mm;
  @bottom-center { content: counter(page); font-family: 'Gentium Book Plus'; font-size: 9pt; color: #444; }
}
html { font-size: 10.5pt; }
body {
  font-family: 'Gentium Book Plus', serif;
  line-height: 1.5; color: #111; margin: 0;
  text-align: justify; hyphens: auto;
  orphans: 3; widows: 3;
}
h1 {
  font-size: 1.75rem; font-weight: 400; text-align: center;
  line-height: 1.25; margin: 1.2rem 0 0.4rem;
}
h1 + p { margin-top: 1.6rem; }
h1::after {
  content: ""; display: block; width: 34mm; margin: 1.1rem auto 0;
  border-bottom: 0.6pt solid #111;
}
h2 {
  font-size: 1.16rem; font-weight: 700; font-variant-caps: small-caps;
  letter-spacing: 0.02em; margin: 2rem 0 0.6rem;
  break-after: avoid; text-align: left;
}
h3 {
  font-size: 1rem; font-weight: 400; font-style: italic;
  margin: 1.3rem 0 0.45rem; break-after: avoid; text-align: left;
}
p { margin: 0.5rem 0; }
ul { margin: 0.5rem 0; padding-left: 1.5rem; }
li { margin: 0.3rem 0; }
ol { margin: 0.5rem 0; padding-left: 1.6rem; }
li::marker { color: #555; }
hr { border: none; text-align: center; margin: 1.8rem 0; }
hr::after { content: "⁂"; font-size: 1rem; color: #333; }
table {
  border-collapse: collapse; margin: 0.9rem auto; font-size: 0.92rem;
  break-inside: avoid;
  border-top: 1.2pt solid #111; border-bottom: 1.2pt solid #111;
}
th, td { padding: 0.28rem 0.9rem; text-align: left; }
thead th { border-bottom: 0.8pt solid #111; font-weight: 700; }
.refs {
  font-size: 0.88rem; line-height: 1.45;
  border-left: 1.2pt solid #999; padding-left: 0.75rem;
  margin: 0.65rem 0 0.4rem;
}
strong { font-weight: 700; }
</style>
</head>
<body>
$(cat "$BUILD/body.html")
</body>
</html>
EOF

chromium --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$OUT" "$BUILD/print.html" >/dev/null 2>&1

echo "built $OUT"
