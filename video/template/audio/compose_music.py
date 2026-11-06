"""Original, calm background music for Nurse Love Company tutorials.
Soft electric piano chords with a gentle arpeggio and a warm pad, about 68 BPM, F major.
Written for this store: no samples, no third party recordings, so there is nothing to license.
Deterministic: same length, same file. Usage: python compose_music.py <seconds> <out.wav>"""
import sys, wave
import numpy as np
SR = 44100
secs = float(sys.argv[1]); out = sys.argv[2]
bpm = 68; beat = 60 / bpm; bar = beat * 4
n = int(SR * secs); mix = np.zeros(n)
def hz(m): return 440 * 2 ** ((m - 69) / 12)
# F major: Fmaj7, Dm9, Bbmaj7, C6/9 (soft, unresolved)
prog = [[53, 57, 60, 64], [50, 57, 60, 64], [46, 53, 57, 62], [48, 55, 57, 62]]
def keys(f, dur, vel):
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * 1.6) * (1 - np.exp(-t * 60))
    tone = np.sin(2*np.pi*f*t) + 0.25*np.sin(2*np.pi*2*f*t)*np.exp(-t*3) + 0.08*np.sin(2*np.pi*3*f*t)*np.exp(-t*5)
    return vel * env * tone
def pad(fs, dur):
    t = np.arange(int(dur * SR)) / SR
    a = np.minimum(1, t / 1.8) * np.minimum(1, (dur - t) / 1.8)
    s = sum(np.sin(2*np.pi*f*t) + np.sin(2*np.pi*f*1.003*t) for f in fs)
    return 0.05 * a * s / len(fs)
def add(sig, at):
    i = int(at * SR)
    if i >= n: return
    j = min(n, i + len(sig)); mix[i:j] += sig[: j - i]
t0 = 0.0; k = 0
while t0 < secs:
    ch = prog[k % 4]
    add(pad([hz(m) for m in ch], bar + 1.5), t0)
    for m in ch: add(keys(hz(m), 3.5, 0.11), t0)
    arp = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12]
    for b in range(4):
        add(keys(hz(arp[b]), 2.5, 0.06), t0 + b * beat + beat / 2)
    t0 += bar; k += 1
# 4 s fade in, 5 s fade out
fade = np.ones(n); fi = int(4 * SR); fo = int(5 * SR)
fade[:fi] = np.linspace(0, 1, fi); fade[-fo:] = np.linspace(1, 0, fo)
mix *= fade
mix /= max(1e-9, np.abs(mix).max()) / 0.5
with wave.open(out, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
