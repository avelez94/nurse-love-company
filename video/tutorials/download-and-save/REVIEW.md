# REVIEW: How to download and save your goodies (pilot)

Rendered `renders/download-and-save.mp4`: 3:24.8, 1920 x 1080, 30 fps, H.264 High, yuv420p, 15.4 MB, fast start
(moov before mdat), no audio track. `hyperframes check --json`: ok, no errors; text contrast passed at every sample.

## Creative calls

- No voiceover and no music: the request did not ask for either, and a voice is a brand decision for the owner.
  Every instruction is on screen; the WebVTT captions mirror the on-screen words for screen readers and muted viewing.
- Computer and phone differ only in how you reach Sign in (person icon vs menu, then Sign in), so Step 1 has two
  labeled demonstrations. Later steps are identical on both; each screen says "Same on a phone" or
  "Same on a computer", and the phone screens are used where the computer layout spreads a control too far
  from its text to read at phone size.
- Saving and finding the file happen in the browser and the device, not on the website. Those steps use labeled
  device cards (Computer, iPhone or iPad, Android) worded from Apple Support and Google Chrome Help, with "Usually",
  instead of drawn or simulated system screens.
- The one-download rule is a full scene before the download is demonstrated, using the site's own wording.
- Step 7 names both real paths: Report a download problem for file trouble (the Support page itself says to use it
  for files), and Support for anything else.

## Measured vs looked at

- Measured: check (lint, runtime, layout, contrast), MP4 codec, size, duration and fast start; the draft was uploaded
  to a local copy of the site's Tutorials system, captions (35 cues) and thumbnail attached, admin preview played it
  with captions, and the public tutorials list and page did not show it.
- Looked at: review sheets for every scene, the cursor or fingertip arrival frame of every demonstration, and frames
  decoded from the final MP4.
- Not checked: playback on a real iPhone or Android device, and the production upload itself (it needs the owner's
  admin sign in).

## Warnings kept on purpose

- `film_silent`: deliberate, see above.
- Every scene's stage carries `data-hold`: the still stretches are reading time, which the brief asked for.

## Weakest moments

- The two device card scenes are long (32 s and 22 s) because each card waits for its reading time. A voiceover
  would let them be shorter.
- Step 2's crop trims the edge of "Hi, Sam" so the My downloads and Support tabs both fit.
