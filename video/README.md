# Nurse Love Company tutorial videos

Branded how to videos made with [HyperFrames](https://hyperframes.heygen.com) (HTML rendered to MP4). This folder is
separate from the website: it has its own `package.json`, the website's Vercel build never installs or runs anything
here, and videos are always rendered on a computer, never on Vercel.

```
video/
  template/                 the reusable template
    build.mjs               turns a tutorial script into a HyperFrames project, captions and a transcript
    assets/                 brand fonts (DM Serif Display, Nunito Sans, SIL Open Font License) and GSAP
    audio/voice.py          speaks each sentence with the local Kokoro voice (Apache 2.0) and lays out the voice track
    audio/compose_music.py  the original background music, composed to each video's length (nothing to license)
  tutorials/_screens/       real screenshots (synthetic customer) and screens.json with element positions
  tutorials/<slug>/         one folder per tutorial
    tutorial.json           the script: narration, on-screen words, screenshots, focus areas, highlight targets
    SPEC.md, REVIEW.md      the brief and the review notes for that video
    out/                    generated captions (.vtt) and transcript (.md)
  build/<slug>/             generated HyperFrames project (editable source)
  build/<slug>-thumbnail/   generated still composition for the thumbnail
  tools/                    local helpers for capturing screens with a synthetic customer
  renders/                  rendered files (not committed)
  FUTURE_TUTORIALS.md       the next videos, and what must be verified before each
```

## Requirements

- Node.js 22 or newer and FFmpeg.
- Chrome for rendering: `npx hyperframes browser ensure` downloads the one HyperFrames uses, or set
  `HYPERFRAMES_BROWSER_PATH` to an existing Chrome Headless Shell.
- Turn off HyperFrames usage telemetry once: `npx hyperframes telemetry disable` (or set `HYPERFRAMES_NO_TELEMETRY=1`).

```bash
cd video
npm install
```

## Voice and music (one time setup)

The narration uses Kokoro, a small open voice model that runs on your computer (Apache 2.0, fine for commercial use).
The tutorials use the voice **Heart** (`af_heart`) at 0.95 speed.

```bash
python3 -m venv ~/.venvs/nlc-voice
~/.venvs/nlc-voice/bin/pip install kokoro-onnx soundfile numpy
npx hyperframes tts "hello" -o /tmp/hello.wav     # first run downloads the Kokoro model to ~/.cache/hyperframes/tts
export VIDEO_PYTHON=~/.venvs/nlc-voice/bin/python
```

Each sentence is spoken once and cached in `tutorials/<slug>/.voice-cache/` (not committed), so rebuilding only
speaks sentences you changed. The music is composed by `template/audio/compose_music.py` (soft piano chords, a
gentle arpeggio and a warm pad, 68 BPM). The voice is normalized to -16 LUFS. The download tutorials set `"musicLevel": -22`, which lands the music
about 12 LU under the voice in the final mix (the level the owner approved). Lower it (for example -26) for quieter
music, or set `"music": false` for none.

To use a person's recording instead (for example the owner's own voice), replace `assets/audio/voice.m4a` in the
generated project with the edited recording, then retime scenes in the HyperFrames editor, or ask for the template
to take recorded sentences instead of `say`.

## Build, look, check, render

```bash
cd video
node template/build.mjs download-and-save-computer   # tutorial.json -> build/<slug> + captions + transcript + thumbnail
cd build/download-and-save-computer
npx hyperframes preview                               # opens the editor preview in your browser
npx hyperframes check --json                          # must report "ok": true
npx hyperframes render --quality delivery --max-bitrate 1.6M -o ../../renders/download-and-save-computer.mp4
```

The computer video is 2:16 and the phone video 2:31, at 1920 x 1080, 30 fps. On a 4 core laptop each render takes roughly 10 to 20 minutes. The
`--max-bitrate 1.6M` cap keeps every tutorial under the website's 50 MB upload limit (1.6 Mbit/s for 4 minutes is
about 48 MB; mostly still screens come out far smaller).

After rendering, make sure the file starts playing before it has fully downloaded (fast start):

```bash
ffmpeg -i ../../renders/download-and-save-computer.mp4 -c copy -movflags +faststart ../../renders/download-and-save-computer-web.mp4
```

Thumbnail (a still HyperFrames composition):

```bash
cd video/build/download-and-save-computer-thumbnail
npx hyperframes snapshot --at 0                     # prints the PNG path; save it as a 1280 x 720 JPG
```

### Editing

- Narration (`say`), on-screen words (`lines`), order and which screenshot to show live in `tutorial.json`.
  Edit it and run `build.mjs` again. The voice is the clock: each line appears as its sentence is spoken, the cursor
  lands about a second into the sentence named by `act` (the last one by default), and captions follow the narration.
- You can also open `build/<slug>` in the HyperFrames desktop app or preview and edit there. `build.mjs` replaces
  that folder, so after hand edits either keep editing there or move the change into `tutorial.json` first.
- Lines may use `<strong>` for emphasis. Nothing else is allowed (it is escaped).
- Without narration, timing is automatic and calm: each line holds 0.6 s plus 0.36 s a word.

### Scene kinds

| kind | what it shows | key fields |
| --- | --- | --- |
| every kind | narration, spoken in order | `say` (sentences) |
| `title` | intro or outro card | `eyebrow`, `title`, `subtitle`, `duration` |
| `screen` | step text on the left; a real screenshot on the right that moves once from the whole screen to `focus`, then highlights `target` with a cursor (computer) or fingertip (phone) | `step`, `title`, `device`, `image`, `focus` [x, y, w, h], `target` (a name from screens.json or [x, y, w, h]), `cursor: false`, `lines` |
| `rule` | an important rule set large | `step`, `title`, `lines`, `sayLineOffset` (sentences before the first line) |
| `devices` | side by side cards (Windows and Mac, or iPhone and Android) | `step`, `title`, `intro`, `devices[]`, `footer`; each item appears with the next sentence |

Make one video per device (computer, phone) rather than mixing them, so every screen matches what the viewer sees.

## Capturing screens (synthetic customer only)

Never record a real customer or use a real download. Use a local copy of the site:

1. Start Postgres, create a local database, and start the site with `tools/local-server.env.example`
   (`npm run build` first so the server can serve the pages).
2. Sign up the synthetic customer on the local site: Sam Taylor, `sam.taylor@example.com`.
3. `npx tsx video/tools/seed-synthetic-customer.mts` adds a sample product with a sample PDF and a paid order.
4. `node tools/capture-screens.cjs desktop <dir>` and `... phone <dir>` capture each step and record where each
   button is. The computer screens use a 1024 px wide window so text wraps into readable lines; the floating
   launcher buttons and the site footer are hidden so they never cover the steps.
5. To capture again, reset the synthetic download in the local database:
   `update entitlements set status='available', redeemed_at=null; delete from download_tokens;`
6. Convert the PNGs to WebP into `tutorials/<slug>/screens/` and write `screens.json` (sizes and element boxes in image pixels).

## Putting a video on the website (stays unpublished until you publish it)

The site stores tutorial videos in Supabase Storage: **MP4 only, H.264, up to 50 MB**, played exactly as uploaded
(no conversion on Vercel). Captions must be WebVTT under 512 KB. Thumbnails are PNG, JPG or WebP up to 10 MB.

1. Admin, Tutorials, **New tutorial**. Title, slug, short description, category (**Using Your Digital Files** for the
   download videos). Make one tutorial per video ("on a computer" and "on a phone"). Save. New tutorials start as
   drafts, which never appear publicly.
2. **Upload video**: the MP4 from `renders/`.
3. **Captions**: paste the `.vtt` from `tutorials/<slug>/out/`, label English, language `en`. They follow the narration.
4. **Thumbnail**: upload the JPG.
5. **Transcript**: paste the transcript text (or leave it empty and the captions are shown as the transcript).
6. **Written instructions**: a numbered list of the steps (the transcript has them).
7. Use the admin preview to watch it. Leave it as a draft until it is approved, then **Publish**.

## Accuracy rules for every tutorial

- Show only the real interface, captured from this codebase, with synthetic customer data.
- Do not invent browser or device behavior. Where it depends on the device, say "usually" and follow the
  browser or device maker's own help pages (Apple Support, Google Chrome Help).
- Never imply the website knows a file was saved. It only knows the download started.
- Only demonstrate features, formats and app compatibility that have been verified (see FUTURE_TUTORIALS.md).
