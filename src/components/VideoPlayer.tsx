import { Captions, CaptionsOff, Maximize } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaptionTrack, TutorialVideo } from '../data/types'
import './VideoPlayer.css'

/*
  Accessible tutorial player built on the native <video> element, so the
  browser's own keyboard and screen reader support comes for free.
  Never autoplays. Captions are on by default and can be toggled.
*/
export function VideoPlayer({ video, captions, title }: { video: TutorialVideo; captions: CaptionTrack[]; title: string }) {
  const frame = useRef<HTMLDivElement>(null)
  const el = useRef<HTMLVideoElement>(null)
  const [captionsOn, setCaptionsOn] = useState(true)

  // Captions given as text become blob URLs so they work on any host.
  const trackUrls = useMemo(
    () => captions.map((c) => c.src ?? (c.vtt ? URL.createObjectURL(new Blob([c.vtt], { type: 'text/vtt' })) : '')),
    [captions],
  )
  useEffect(() => () => trackUrls.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u)), [trackUrls])

  useEffect(() => {
    const v = el.current
    if (!v) return
    const apply = () => {
      for (const t of Array.from(v.textTracks)) t.mode = captionsOn && t === v.textTracks[0] ? 'showing' : 'hidden'
    }
    apply()
    v.textTracks.addEventListener?.('addtrack', apply)
    return () => v.textTracks.removeEventListener?.('addtrack', apply)
  }, [captionsOn, trackUrls])

  // Adaptive streaming (Mux): Safari plays HLS natively, other browsers use hls.js.
  const hlsSrc = video.kind === 'hls' ? video.src : null
  const [streamError, setStreamError] = useState('')
  useEffect(() => {
    const v = el.current
    if (!v || !hlsSrc) return
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = hlsSrc
      return
    }
    let destroyed = false
    let hls: { destroy: () => void } | null = null
    import('hls.js')
      .then(({ default: Hls }) => {
        if (destroyed) return
        if (!Hls.isSupported()) {
          setStreamError('This browser cannot play this video. The written instructions below cover the same steps.')
          return
        }
        const h = new Hls({ capLevelToPlayerSize: true })
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setStreamError('The video could not load. Please refresh the page or try again later.')
        })
        h.loadSource(hlsSrc)
        h.attachMedia(v)
        hls = h
      })
      .catch(() => setStreamError('The video player could not load.'))
    return () => {
      destroyed = true
      hls?.destroy()
    }
  }, [hlsSrc])

  const fullscreen = async () => {
    const v = el.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (frame.current?.requestFullscreen) await frame.current.requestFullscreen()
      else v?.webkitEnterFullscreen?.()
    } catch {
      v?.webkitEnterFullscreen?.()
    }
  }

  if (video.kind === 'embed') {
    return (
      <div className="video">
        <div className="video__frame">
          <iframe src={video.url} title={title} allow="fullscreen; picture-in-picture" allowFullScreen loading="lazy" />
        </div>
      </div>
    )
  }

  return (
    <div className="video">
      <div className="video__frame" ref={frame}>
        <video ref={el} controls playsInline preload="metadata" poster={video.poster ?? undefined} aria-label={`${title} video`} crossOrigin={video.kind === 'hls' ? 'anonymous' : undefined}>
          {video.kind === 'file' && <source src={video.src} type={video.type} />}
          {captions.map((c, i) => (
            <track key={c.srclang + i} kind="captions" label={c.label} srcLang={c.srclang} src={trackUrls[i]} default={i === 0} />
          ))}
          Your browser cannot play this video. The written instructions below cover the same steps.
        </video>
      </div>
      {streamError && (
        <p className="form-error" role="alert">
          {streamError}
        </p>
      )}
      {captions.length > 0 && (
        <div className="video__tools">
          <button type="button" className="chip" aria-pressed={captionsOn} onClick={() => setCaptionsOn((on) => !on)}>
            {captionsOn ? <Captions aria-hidden="true" size={18} /> : <CaptionsOff aria-hidden="true" size={18} />}
            {captionsOn ? 'Captions on' : 'Captions off'}
          </button>
          <button type="button" className="chip" onClick={fullscreen}>
            <Maximize aria-hidden="true" size={18} />
            Fullscreen
          </button>
        </div>
      )}
    </div>
  )
}
