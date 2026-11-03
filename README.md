# HTML-PPT Studio (working name)

Don't regenerate an AI-made HTML deck just to fix one word.

Open an HTML presentation in your browser, fix its text and pictures, and save it again with the design intact, or export it to PDF and PPTX. Files stay in the browser and scripts inside them never run.

[한국어](README.ko.md)

## What it does

- **Edit existing HTML (L1):** text, pictures and some formatting. Everything you didn't touch stays byte-identical to the original.
- **Convert to elements (L2) or freeze as pictures (L3):** for when you need to move things. A report says what changes.
- **New decks:** text, images, shapes, lines, tables, charts, code and SVG.
- **Security scan:** static checks for malicious patterns before a file opens. Please read [its limits](#limits-of-the-security-scan).
- **Export:** single-file HTML that presents offline, light presentation-only HTML, PDF through the browser's print dialog, and PPTX (editable first or appearance first).
- **Present:** full screen and a presenter view with notes, timer and next slide.

## Getting started

Requires Node.js 22+ and pnpm.

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # static files in apps/editor-web/dist
```

Command line:

```sh
pnpm scan <file> [--json]       # security scan; exit 0, 1 suspicious, 2 dangerous
pnpm deck-to-pdf <deck.html>    # PDF file with selectable text (needs Chrome)
pnpm schema                     # regenerate docs/schema-v2.json
```

## Limits of the security scan

This **is not antivirus.** It looks for known patterns without running the file: disguised executables, HTML smuggling, obfuscation, crypto miners, phishing forms, keyloggers, ClickFix lures. New or well-hidden malware can get past it, so no result ever says "safe". The best possible result reads "no known threats detected".

The main protection is isolation, not the scan: whatever the result, a file's scripts do not run in this app. **Saved HTML keeps the original scripts, though,** so don't open an untrusted file directly in a browser. See [THREAT_MODEL.md](THREAT_MODEL.md).

## Scope

There is no promise of perfect automatic conversion. Imports and exports tell you what is editable and what becomes a picture. See [COMPATIBILITY.md](COMPATIBILITY.md), [docs/import-limitations.md](docs/import-limitations.md) and [docs/export-fidelity.md](docs/export-fidelity.md). Scan findings and import warnings are in Korean for now; menus have English.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): structure and package boundaries
- [docs/phase0/G0-report.md](docs/phase0/G0-report.md): verification results and what is still unverified (Korean)
- [docs/decisions/](docs/decisions/): decision records
- [docs/schema-v2.md](docs/schema-v2.md): document format
- [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md)

## About the name

"HTML-PPT Studio" is a working name, to change before public release. Trademark, package and domain availability have not been checked.

## License

[MIT](LICENSE)
