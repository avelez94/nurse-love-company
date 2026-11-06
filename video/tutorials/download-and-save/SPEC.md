# SPEC: How to download and save your goodies

GOAL:    a customer finishes knowing they get one download, how to start it, where the file usually lands on their
         device, how to find it again, and where to get help. Nobody should think the website confirms a saved file.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, MP4 (H.264), no audio
TIME:    204.8 s x 30 fps = 6143 frames; 18 scenes; no music, no voiceover (captions mirror the on-screen words)
LOOK:    the website's own tokens. Ground ivory #fffaf6, panel blush #fff0f2, ink burgundy #680c35,
         accent raspberry #d80853 (step numbers, emphasis, highlight ring, progress), border #efd8df.
         Display DM Serif Display 400 (step titles 66 px, rule title 84 px, intro 104 px).
         Body Nunito Sans (lines 38 px, device cards 31 px, minimum 28 px).
         Medium: real website screenshots in a white card, 28 px radius, 2 px border, shadow 0 24 60 at 16%.
OBJECTS: the real site header (person icon), the sign in form, the account tabs, the My downloads card, the one
         download reminder, the "download has started" message, "Download used", Report a download problem,
         the Support form. Device cards for computer, iPhone or iPad, Android, labeled with their names.
MOTION:  stage: blur swap, in 0.4 s power2.out, out 0.3 s power2.in; the ground never cuts.
         Lines: opacity and blur 6 px to 0 in 0.45 s power3.out, one at a time, each held 0.6 s + 0.36 s a word.
         Camera: one move per screen, whole screen to the focus area in 1.5 s power2.inOut, then still.
         Cursor or fingertip: fades in, travels 1.2 s power2.inOut, one press (scale 0.86 or 0.8, 0.12 s then 0.2 s).
         Highlight: raspberry ring, fades in over 0.45 s as the cursor arrives, then holds.
SHOTS:   intro (0 to 6.5 s): title on screen from frame 0.
         Step 1 computer: person icon; email, password, Sign in. Step 1 phone: menu; Sign in; form.
         Step 2: My downloads tab. Step 3: the purchase card, "1 download available".
         Step 4: the one download rule, then Download (phone card) and the reminder (computer dialog).
         Step 5: "has started" message (phone), then where files usually go by device.
         Step 6: how to find it again by device, then "Download used" and why the site can't confirm a save.
         Step 7: Report a download problem (phone), Support tab (computer). Outro.
BANNED:  dark grounds, glow, gradients beyond the site's own blush, floating loops, click rings beyond one press,
         text that moves while being read, invented device or browser screens, real customer data,
         any line implying the website confirms a saved file, the footer note from the local preview store.
QA:      every target ring sits on its control at the cursor's arrival (checked at 11.3, 19.0, 26.5, 33.0, 39.3,
         46.1, 82.9, 91.4, 180.4, 192.5 s); every line readable at 360 px wide; check --json ok.
