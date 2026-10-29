/*
  Offers a file to the visitor. Inside the hosted Claude preview the page asks
  the viewer's save prompt (the "downloads" capability); on a normal website it
  falls back to a standard browser download.
*/

type SaveFn = (req: { filename: string; data: Blob }) => Promise<unknown>
interface ClaudeHost {
  use?: (name: string) => Promise<{ save: SaveFn } | null>
}

export type DownloadOutcome = 'saved' | 'declined' | 'failed'

export async function offerDownload(filename: string, bytes: Uint8Array, type: string): Promise<DownloadOutcome> {
  const blob = new Blob([bytes as BlobPart], { type })
  const host = (window as unknown as { claude?: ClaudeHost }).claude
  if (host?.use) {
    try {
      const downloads = await Promise.race([
        host.use('downloads'),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3000)),
      ])
      if (downloads) {
        try {
          await downloads.save({ filename, data: blob })
          return 'saved'
        } catch (err) {
          const code = (err as { code?: string })?.code
          return code === 'declined' ? 'declined' : 'failed'
        }
      }
    } catch {
      /* fall through to a normal download */
    }
  }
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    return 'saved'
  } catch {
    return 'failed'
  }
}
