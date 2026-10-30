/*
  Builds the Freebie Corner prototype sample: a general daily planner page.
  It is a placeholder, not one of Nurse Love Company's finished resources.
  Written by hand so the preview needs no PDF library.
*/

const W = 612
const H = 792

function esc(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/•/g, '\\225')
}

function textOp(x: number, y: number, size: number, font: 'F1' | 'F2', text: string, rgb = '0.408 0.047 0.208') {
  return `BT ${rgb} rg /${font} ${size} Tf ${x} ${y} Td (${esc(text)}) Tj ET`
}

function line(x1: number, y1: number, x2: number, y2: number, rgb = '0.937 0.847 0.875', w = 0.8) {
  return `${rgb} RG ${w} w ${x1} ${y1} m ${x2} ${y2} l S`
}

function rect(x: number, y: number, w: number, h: number, rgb = '0.847 0.031 0.325', lw = 1) {
  return `${rgb} RG ${lw} w ${x} ${y} ${w} ${h} re S`
}

export function buildSamplePlannerPdf(title = 'Daily Planner', note = 'Prototype sample. Not a finished Nurse Love Company resource.'): Uint8Array {
  const ops: string[] = []
  const left = 54
  const right = W - 54

  ops.push('1 0.98 0.965 rg 0 0 612 792 re f')
  ops.push(textOp(left, H - 80, title.length > 28 ? 20 : 30, 'F2', title))
  ops.push(textOp(left, H - 102, 10, 'F1', note, '0.54 0.35 0.42'))
  ops.push(textOp(right - 160, H - 80, 11, 'F1', 'Date'))
  ops.push(line(right - 130, H - 82, right, H - 82, '0.408 0.047 0.208', 0.6))

  // Top 3
  let y = H - 150
  ops.push(textOp(left, y, 14, 'F2', 'Top 3'))
  for (let i = 0; i < 3; i++) {
    y -= 30
    ops.push(rect(left, y - 2, 12, 12))
    ops.push(line(left + 22, y - 2, left + 240, y - 2))
  }

  // Schedule column on the right
  let sy = H - 150
  const sx = left + 280
  ops.push(textOp(sx, sy, 14, 'F2', 'Schedule'))
  const hours = ['7:00', '8:00', '9:00', '10:00', '11:00', '12:00', '1:00', '2:00', '3:00', '4:00', '5:00', '6:00']
  for (const h of hours) {
    sy -= 30
    ops.push(textOp(sx, sy, 9, 'F1', h, '0.54 0.35 0.42'))
    ops.push(line(sx + 38, sy - 2, right, sy - 2))
  }

  // Notes
  y -= 50
  ops.push(textOp(left, y, 14, 'F2', 'Notes'))
  for (let i = 0; i < 9; i++) {
    y -= 26
    ops.push(line(left, y, left + 240, y))
  }

  // Bottom lines across full width
  let by = 190
  ops.push(textOp(left, by, 14, 'F2', 'Brain dump'))
  for (let i = 0; i < 4; i++) {
    by -= 26
    ops.push(line(left, by, right, by))
  }

  ops.push(line(left, 60, right, 60, '0.937 0.847 0.875', 0.6))
  ops.push(textOp(left, 44, 9, 'F1', 'Nurse Love Company • Made by a nurse, for nurses. • Prototype sample for preview only', '0.54 0.35 0.42'))

  const stream = ops.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    `<< /Title (${esc(title)}) /Producer (Nurse Love Company preview) >>`,
  ]

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  return new TextEncoder().encode(out)
}
