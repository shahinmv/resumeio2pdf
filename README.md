# resumeio2pdf

Export your own [resume.io](https://resume.io) résumé as a **multi-page PDF** — for free.

resume.io lets you build and preview a résumé for free but charges to download the PDF, and its free image endpoint only serves page 1. This tool works from the **preview your browser already renders for free** plus **your own résumé data from your own logged-in session**, so it gets **every page** — without ever touching resume.io's payment system or seeing your login.

## 🌐 Use it — no install (web app)

**→ https://shahinmv.github.io/resumeio2pdf/**

1. **Drag the "Grab my résumé" button** to your bookmarks bar (one time).
2. Open your résumé on **resume.io** (logged in) and **click that bookmark** — it copies your résumé data to your clipboard.
3. Back on the tool, **paste** and click **Download PDF**.

You get a clean, true-vector, multi-page PDF with **selectable text** and **clickable links**, set in Times New Roman (resume.io's "London" font). Everything runs in your browser — **your data never leaves your device**, and there is no login on this site.

> Why a bookmarklet? A website can't read your resume.io session (and shouldn't — that would mean handing over your login). The bookmarklet runs in *your* tab, in *your* session, and only hands the data to the page in your own browser.

## 💻 Command-line version (advanced / pixel-exact)

For automation or a pixel-exact copy of your *exact template*, two Node scripts (Node 21+, no `npm install`):

```sh
# Launch Chrome with remote debugging, then log into resume.io and open your résumé:
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/.resumeio-dl" --remote-debugging-port=9222 \
  --force-device-scale-factor=3 "https://resume.io/app"
```

```sh
node resumeio_vector.mjs ./resume.pdf            # true-vector, ATS-friendly (London layout)
node resumeio_vector.mjs ./resume.pdf --font="Arimo"   # match other templates' fonts
node resumeio_capture.mjs ./resume.pdf           # pixel-exact replica of ANY template + OCR text layer + links
```

| | Web app / `resumeio_vector.mjs` | `resumeio_capture.mjs` |
|---|---|---|
| Output | **True vector**, selectable text, links, tagged/ATS-friendly, ~60 KB | Pixel-faithful image of your template + OCR text layer + links (~180–270 DPI) |
| Layout | Clean Times-New-Roman "London" layout | **Exactly your template** (any of resume.io's) |
| Needs | — | `tesseract` on PATH (`brew install tesseract`) |

`resumeio_capture.mjs` works with **every** template because it captures whatever the editor renders. The vector path renders any résumé's data in one clean layout.

## How it works

- **Vector** (web app + `resumeio_vector.mjs`): reads your résumé's structured data (`/api/app/resumes/{id}`) from your own session and re-typesets it as a faithful HTML page — driven by your résumé's own `sectionsOrder`, section titles, accent colour, dates, and **all** section types (profile, work, education, links, skills, languages, courses, internships, volunteering, references, certifications, awards, publications, hobbies, custom sections…) — then renders it to PDF with the browser's own engine (`Page.printToPDF` / Save-as-PDF). True vector, selectable text, embedded font, real links.
- **Capture** (`resumeio_capture.mjs`): pages through the editor preview over the Chrome DevTools Protocol, reads each page's `<canvas>`, OCRs it (`tesseract`) into an invisible text layer, adds link annotations, and assembles a multi-page PDF.

## Fonts & licensing

The "London" template uses **Times New Roman**; the vector output uses **[Tinos](https://fonts.google.com/specimen/Tinos)** — an open-licensed font *metrically identical* to Times New Roman — so the type matches without bundling any proprietary font. `--font` picks another open [Google Font](https://fonts.google.com) (e.g. `Arimo`≈Arial, `Gelasio`≈Georgia).

## Limitations

- Vector mode renders **one layout** (single-column "London"). Other resume.io templates have unique designs; your content is all there and professional, but styled as London. Use **capture mode** for your template's exact appearance.
- Capture mode is raster + an OCR text layer (~98–99% text accuracy).
- The byte-identical paid export with resume.io's licensed fonts is their paid product and is not reproduced here.

## Legal & ethical

This tool only uses the **free preview resume.io already renders in your browser** and **your own résumé data from your own logged-in session**. It does **not** bypass, forge, or interact with resume.io's payment/JWT system, and bundles no proprietary fonts. Intended for **personal use** to export résumés you created. You are responsible for complying with [resume.io's Terms of Service](https://resume.io/terms-and-conditions). If you rely on resume.io, please support them.

## License

MIT. Fonts are loaded from Google Fonts (open licenses) at render time and are not redistributed here.
