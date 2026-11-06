"""Voice for Nurse Love Company tutorials, with the local Kokoro model (Apache 2.0).

  python voice.py synth  <request.json>   speak each sentence once (cached by text, voice and speed)
  python voice.py place  <request.json>   lay the sentences on one timeline and write a WAV

The Kokoro model and voices are the ones HyperFrames downloads on its first
`npx hyperframes tts` run (~/.cache/hyperframes/tts). Needs: pip install kokoro-onnx soundfile numpy
"""
import hashlib, json, os, sys
import numpy as np
import soundfile as sf

CACHE = os.path.expanduser('~/.cache/hyperframes/tts')
MODEL = os.path.join(CACHE, 'models', 'kokoro-v1.0.onnx')
VOICES = os.path.join(CACHE, 'voices', 'voices-v1.0.bin')


def synth(req):
    from kokoro_onnx import Kokoro
    k = None
    os.makedirs(req['cacheDir'], exist_ok=True)
    out = []
    for text in req['sentences']:
        key = hashlib.sha1(f"{req['voice']}|{req['speed']}|{text}".encode()).hexdigest()[:16]
        path = os.path.join(req['cacheDir'], f'{key}.wav')
        if not os.path.exists(path):
            if k is None:
                if not os.path.exists(MODEL):
                    sys.exit('Kokoro model missing: run `npx hyperframes tts "hello"` once to download it.')
                k = Kokoro(MODEL, VOICES)
            lang = 'en-gb' if req['voice'].startswith('b') else 'en-us'
            samples, sr = k.create(text, voice=req['voice'], speed=req['speed'], lang=lang)
            # Trim near silence at both ends so timing follows the words.
            a = np.abs(samples)
            idx = np.where(a > 0.01)[0]
            if len(idx):
                samples = samples[max(0, idx[0] - int(0.03 * sr)): idx[-1] + int(0.08 * sr)]
            sf.write(path, samples, sr, subtype='PCM_16')
        info = sf.info(path)
        out.append({'text': text, 'file': path, 'duration': info.frames / info.samplerate})
    print(json.dumps(out))


def place(req):
    sr = 24000
    total = int(req['length'] * sr) + sr
    track = np.zeros(total, dtype=np.float32)
    for p in req['placements']:
        data, r = sf.read(p['file'], dtype='float32')
        if r != sr:
            sys.exit(f'Unexpected sample rate {r}')
        i = int(round(p['at'] * sr))
        j = min(total, i + len(data))
        track[i:j] += data[: j - i]
    sf.write(req['out'], track[: int(req['length'] * sr)], sr, subtype='PCM_16')
    print(json.dumps({'ok': True}))


if __name__ == '__main__':
    cmd, path = sys.argv[1], sys.argv[2]
    with open(path) as f:
        req = json.load(f)
    {'synth': synth, 'place': place}[cmd](req)
