export interface TourBox {
  top: number
  left: number
  width: number
  height: number
}

export interface TourViewport {
  width: number
  height: number
}

export function getTourHighlight(box: TourBox, viewport: TourViewport): TourBox | null {
  const padding = 6
  const left = Math.max(2, box.left - padding)
  const top = Math.max(2, box.top - padding)
  const right = Math.min(viewport.width - 2, box.left + box.width + padding)
  const bottom = Math.min(viewport.height - 2, box.top + box.height + padding)
  if (box.width <= 0 || box.height <= 0 || right <= left || bottom <= top) return null
  return { left, top, width: right - left, height: bottom - top }
}

// One even-odd path shades only the area outside the rounded cutout.
export function getTourMaskPath(box: TourBox, viewport: TourViewport): string {
  const { left: x, top: y, width, height } = box
  const right = x + width
  const bottom = y + height
  const r = Math.min(10, width / 2, height / 2)
  return [
    `M0 0H${viewport.width}V${viewport.height}H0Z`,
    `M${x + r} ${y}H${right - r}Q${right} ${y} ${right} ${y + r}`,
    `V${bottom - r}Q${right} ${bottom} ${right - r} ${bottom}`,
    `H${x + r}Q${x} ${bottom} ${x} ${bottom - r}`,
    `V${y + r}Q${x} ${y} ${x + r} ${y}Z`,
  ].join(' ')
}

export function getTourLabelPosition(
  target: TourBox | null,
  label: { width: number; height: number },
  viewport: TourViewport,
): { left: number; top: number } {
  const margin = 16
  const gap = 18
  const clampX = (x: number) => Math.max(margin, Math.min(x, viewport.width - label.width - margin))
  const clampY = (y: number) => Math.max(margin, Math.min(y, viewport.height - label.height - margin))
  if (!target) {
    return {
      left: clampX((viewport.width - label.width) / 2),
      top: clampY((viewport.height - label.height) / 2),
    }
  }
  const centerX = clampX(target.left + (target.width - label.width) / 2)
  const centerY = clampY(target.top + (target.height - label.height) / 2)
  const candidates = [
    { left: target.left + target.width + gap, top: centerY },
    { left: target.left - label.width - gap, top: centerY },
    { left: centerX, top: target.top + target.height + gap },
    { left: centerX, top: target.top - label.height - gap },
  ]
  const fits = candidates.find(({ left, top }) => left >= margin && top >= margin
    && left + label.width <= viewport.width - margin
    && top + label.height <= viewport.height - margin)
  if (fits) return fits

  // For oversized panels, use the edge with the most available space.
  const below = viewport.height - target.top - target.height
  return { left: centerX, top: below >= target.top
    ? clampY(target.top + target.height + gap)
    : clampY(target.top - label.height - gap) }
}
