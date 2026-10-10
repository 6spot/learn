# Exact PDF rendering

`packages/pdf-renderer` renders already positioned `PaperLayout` glyph IDs through `renderPdf(layout, provider, {maxBytes}) -> Promise<Uint8Array>`. Read [paper contracts](paper-contracts.md), [font metrics](font-metrics.md), and [PAPER_ENGINE](../../../docs/PAPER_ENGINE.md) before changes. It must not reshape, reflow, paginate, read files or use platform APIs.

PDF pages are exactly 210 × 297 mm; convert mm to points and y-down layout coordinates to PDF y-up once. Draw every grid segment with the layout stroke, and each glyph using its explicit text matrix/GID. Full layout/style/resource/ink preflight precedes output. Bounded serialization enforces the final byte limit before allocating the output buffer; resource/page/glyph limits reject safely.

Each used original TTF is hash/length pinned, losslessly compressed and embedded in full as FontFile2, with CIDFontType2/Identity-H and Identity CIDToGIDMap. Original font license attachments travel with the PDF. The renderer owns a **byte snapshot before validation**: a provider may return a shared mutable buffer, so checking a hash and retaining that external array across an await is unsafe. Embed exactly the copied, verified bytes.

The contract contains glyph IDs and source ranges, not original character strings. Do not fabricate a ToUnicode map or promise text extraction/copying. Output supports visual rendering/printing; font distribution permission and physical printing remain separate acceptance gates.

Run `npm run test:pdf`; tests verify original FontFile2/attachment bytes after decompression, A4 geometry, operators, multiple pages, four templates and modes, resource errors/ceilings and host-independent equal bytes. `npm --prefix packages/pdf-renderer run samples` uses independent pdfinfo/pdffonts checks for twelve samples. Sample readability, structural checks and exact font bytes do not constitute physical-print or legal acceptance.
