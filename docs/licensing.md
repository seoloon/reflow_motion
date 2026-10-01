# Licensing

ReFlow Motion is released under **GNU GPL v3 or later** (`LICENSE`).

## Rules

1. Every dependency that is **linked or bundled** into the application must be GPLv3-compatible
   (MIT, BSD, Apache-2.0, ISC, MPL-2.0, LGPL, GPL-3.0, Unlicense/CC0, Zlib).
2. Apache-2.0 is compatible with GPLv3 (not GPLv2). Fine here.
3. No proprietary SDKs in core. Optional integrations must live behind a process/IPC boundary.
4. Every dependency is recorded in `THIRD_PARTY.md` before it ships.
5. No code is copied from another project without a verified license, and attribution is kept.

## The Remotion question (the important one)

`remotion` and `@remotion/*` are published under the **Remotion License**
(`SEE LICENSE IN LICENSE.md`). It is source-available, not OSI-approved, and imposes a
paid company license on larger commercial users. It is **not GPL-compatible** to bundle or
link into a GPL application, and we must not impose its terms on ReFlow users implicitly.

Decision:

- ReFlow Motion **never bundles, vendors, or imports** `remotion` / `@remotion/*`.
- Remotion is used **only from the user's own project** (`node_modules` of the opened
  project), executed as a **separate child process** (`remotion studio`, `remotion render`).
  The user's own license relationship with Remotion applies to their project.
- The preview is an iframe pointing at the project's Remotion dev server (same-origin
  isolation, separate process: "mere aggregation").
- Our component-metadata API (`motionMetadata`) is a plain data convention. It does not
  import Remotion types, so user components stay valid without ReFlow installed.
- `docs/` and the UI tell users that Remotion has its own license terms.

This must be reviewed by a lawyer before a 1.0 release; the above is an engineering decision, not legal advice.

## FFmpeg

Not bundled. Rendering uses the FFmpeg that Remotion itself downloads/finds. If we ever
bundle FFmpeg, only an LGPL build (no `--enable-gpl`/`nonfree`) in a separate process is acceptable
without further analysis; GPLv3 builds are compatible with our license but must ship source offers.

## Fonts / assets in the UI

Only OFL / Apache-licensed fonts and icon sets (e.g. Lucide: ISC) may be shipped.

## Integration method glossary

| Term | Meaning |
|------|---------|
| static | compiled into our binary / bundled into our JS |
| dynamic | loaded as a shared library or runtime-installed package |
| process | separate executable we spawn; communication via stdio/HTTP |
