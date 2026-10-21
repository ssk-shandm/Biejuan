import type { TourBox } from './tourGeometry'

export interface TourScene {
  label: TourBox
  highlight: TourBox | null
  spotlightOpacity: number
}

export function interpolateTourBox(from: TourBox, to: TourBox, progress: number): TourBox {
  const mix = (start: number, end: number) => start + (end - start) * progress
  return {
    left: mix(from.left, to.left), top: mix(from.top, to.top),
    width: mix(from.width, to.width), height: mix(from.height, to.height),
  }
}

/** Freeze both endpoints, then use one clock for the card, cutout and outline. */
export function getTourMotionFrame(from: TourScene, to: TourScene, progress: number): TourScene {
  const t = Math.max(0, Math.min(1, progress))
  const eased = t * t * (3 - 2 * t)
  const startHighlight = from.highlight ?? to.highlight
  const endHighlight = to.highlight ?? from.highlight
  return {
    label: interpolateTourBox(from.label, to.label, eased),
    highlight: t === 1 ? to.highlight : startHighlight && endHighlight
      ? interpolateTourBox(startHighlight, endHighlight, eased) : null,
    spotlightOpacity: from.spotlightOpacity + (to.spotlightOpacity - from.spotlightOpacity) * eased,
  }
}

export function getTourContentOpacity(progress: number): number {
  if (progress < .2) return Math.max(0, 1 - progress / .2)
  return Math.min(1, Math.max(0, (progress - .35) / .65))
}
