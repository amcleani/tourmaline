# PDF test fixtures

Small PDFs typeset from LaTeX sources in `src/`, with hand-written ground
truth in `expected/<name>.json`. The ground truth comes from the LaTeX
sources (page breaks and column breaks are forced in the source), never from
running a layout heuristic, so it can be used to test the algorithms that
will be written against it:

- **Phase 1 (viewer):** page count and sizes, rotation, text layer, outline,
  search (ligatures, hyphenated words), mixed page sizes.
- **Phase 5 (focus mode):** grouping text items into lines and ordering them
  (`readingOrder`), including two-column pages with full-width elements.
- **Phase 6 (navigation):** internal links (`links`) and text-only references
  that must be found by pattern (`references`).

The PDFs are committed, so tests do not need TeX. `test/fixtures.test.ts`
only checks that each PDF matches its JSON (page count and sizes, text layer,
every anchor present on its page, outline, links); it deliberately does **not**
check reading order, which is what the future algorithm is tested on.

## Fixtures

| Fixture | Pages | Size | What it covers |
|---|---|---|---|
| `one-column` | 3 | A4 | Sections and subsections with a hyperref outline, a footnote, a numbered display equation, a figure with caption, fi/fl/ffi ligatures (`efficient`, `office`, `difficulty`, `flipped`), and a word hyphenated across a line break (`represen-`/`tational`, forced in the source). |
| `two-column` | 3 | Letter | Conference layout: full-width title, authors and abstract over two columns; a full-width `figure*` at the top of page 2; a single-column figure inside the left column; headings inside columns; a footnote at the foot of the left column; a reference list in the right column. Column breaks forced with `\newpage`. |
| `two-column-midpage` | 2 | A4 | Full-width elements in the **middle** of a page (multicol): columns, then a wide figure, then columns again (page 1); columns, a wide display equation, columns, then a full-width paragraph (page 2). |
| `shuffled-stream` | 2 | Letter | Blocks placed at absolute positions and drawn in a scrambled order, so the order of pdf.js text items is **not** reading order (in the other fixtures, as in most LaTeX output, it happens to be close). Page 1 two-column, page 2 one column. |
| `math-heavy` | 2 | A4 | Dense inline math, numbered `equation`/`align`/`cases` displays, matrices, definition/theorem/lemma/proof environments. |
| `linked` | 3 | A4 | hyperref: every `\cite` (single `[1]` and multiple `[2, 3]`), `\ref` (sections, figures) and `\eqref` is an internal link; 8-entry bibliography on page 3; outline. |
| `unlinked` | 3 | A4 | The same body as `linked` (`src/paper-body.tex`) without hyperref: identical text and pagination, but no link annotations and no outline, so references exist only as text ("[3]", "Figure 2", "Eq. (1)", "Fig. 1", "Section 2"). |
| `mixed-page-sizes` | 4 | mixed | A4 portrait, A4 landscape (landscape MediaBox), US Letter portrait, and a portrait Letter MediaBox with `/Rotate 90`. |
| `scanned` | 2 | A4 | Image-only: pages 1–2 of `one-column.pdf` rasterised to 1-bit PNG at 150 dpi and placed slightly skewed. No fonts, no text layer. |

## Expected JSON schema

```jsonc
{
  "fixture": "two-column",            // name; the PDF is <fixture>.pdf
  "file": "two-column.pdf",
  "source": "src/two-column.tex",
  "description": "…",
  "hasTextLayer": true,               // false only for `scanned`
  "hasLinks": false,                  // any link annotations at all
  "pageCount": 3,
  "pages": [
    {
      "page": 1,                      // 1-based
      "size": [612, 792],             // MediaBox width, height in PDF points (unrotated)
      "rotate": 0,                    // /Rotate in degrees
      "displaySize": [792, 612],      // only when rotate != 0: size as displayed
      "columns": 2,                   // body text columns on this page (1 or 2)
      "readingOrder": [               // in the order a person reads the page
        { "text": "Column-Aware Reading Order for Scholarly Documents",
          "kind": "title",
          "fullWidth": true },        // spans both columns; read where it sits
        { "text": "A two-column page is read as two narrow pages",
          "kind": "paragraph",
          "fullWidth": false,
          "column": "left" }          // "left" | "right" for non-full-width anchors
      ]
    }
  ],
  "outline": [                        // flattened depth-first; [] if the PDF has none
    { "title": "1 Introduction", "level": 1, "page": 1 }
  ],
  "linksComplete": true,              // `links` lists every link annotation in the file
  "links": [                          // `linked` (and the one footnote link in `one-column`)
    { "text": "[2, 3]", "page": 1,    // reference as printed, and the page it is on
      "target": { "kind": "bibliography", "label": "[3]", "page": 3 } }
  ],
  "references": [ /* same shape as links; text-only (unlinked, math-heavy) */ ],
  // Optional extras, per fixture:
  "equations": [ { "number": "1", "page": 2, "env": "equation", "fullWidth": true } ],
  "figures": [ { "label": "Figure 1", "page": 2, "fullWidth": true } ],
  "theorems": [ { "label": "Theorem 2", "page": 1 } ],
  "hyphenated": [ { "word": "representational", "page": 3, "parts": ["represen-", "tational"] } ],
  "search": [ { "query": "efficient", "pages": [3], "acrossLineBreak": false, "note": "ffi ligature" } ],
  "streamOrderIsReadingOrder": false, // `shuffled-stream` only
  "derivedFrom": { "fixture": "one-column", "pages": [1, 2] } // `scanned` only
}
```

Notes:

- **Anchors** (`readingOrder[].text`) are copied verbatim from the source:
  5–10 words at the start of each paragraph, caption, footnote, abstract or
  reference entry, and the full text of short headings, titles and author
  lines. They avoid math and hyphenation points, so each occurs in the
  pdf.js text of its page after NFKC normalisation (which expands the
  fi/fl/ffi ligatures) and collapsing whitespace to single spaces, joining
  text items in stream order with a space at each `hasEOL`. Displayed
  equations are represented by their number, e.g. `"(1)"`, with
  `kind: "equation"`.
- **`kind`** is one of `title`, `author`, `abstract`, `heading`, `paragraph`,
  `caption`, `footnote`, `equation`, `theorem`, `proof`, `reference`.
- **`fullWidth`/`column`** are only present on pages with `columns: 2`. On
  those pages the order is: full-width elements where they sit, and for each
  band of columns between them, the left column top to bottom, then the right
  column. A footnote comes at the end of the column that contains it. Page
  numbers are not anchors.
- **Rotation:** `size` is the unrotated MediaBox (pdf.js `page.view`);
  `getViewport({ scale: 1 })` gives `displaySize` for rotated pages.
- **`links` / `references`:** `text` is the whole reference as printed; for
  multi-citations like `[2, 3]` there is one entry per target. `target.label`
  is text that identifies the target on its page (`"[3]"` at the start of the
  bibliography entry, `"Figure 1"` in the caption, `"(1)"` as the equation
  number, `"2 Model"` as the section heading). With hyperref the link
  rectangle usually covers only the number (`1` in `[1]` or in `Eq. (1)`).
- **`search`:** case-insensitive; `pages` lists every page where the query
  occurs. Entries with `acrossLineBreak: true` are hyphenated at a line end
  and are only found by a search that joins hyphenated lines.

## Rebuilding

Requires TeX Live (`pdflatex`) on PATH, plus `pdftoppm` or Ghostscript
(`rungs`/`gswin64c`/`gs`) for `scanned`. No network access is needed.

```bash
npm run build:fixtures                          # rebuild every PDF (= node scripts/build-fixtures.mjs)
node scripts/build-fixtures.mjs linked unlinked # just these
node scripts/build-fixtures.mjs --build-dir=/some/dir   # keep .aux/.log there
npx vitest run test/fixtures.test.ts            # check PDFs against expected/*.json
```

LaTeX auxiliary files go to a temporary directory. `src/fixture-common.tex`
removes timestamps and trailer ids, so rebuilding with the same TeX Live gives
byte-identical PDFs. If you change a source, update its JSON by hand from the
source (not from extracted text), then run the sanity test. `scanned` is
rasterised from `one-column.pdf`, so rebuild it after changing `one-column`.

Real papers from the vault for manual checks are listed in
[REAL_PAPERS.md](REAL_PAPERS.md) (never commit them).
