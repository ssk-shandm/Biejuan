import { ref } from 'vue'

/** 教程是否已完成过（用于“首次安装自动播放，之后手动触发”） */
const TOUR_DONE_KEY = 'exam.newcomer-tour.done'

function readDone(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(TOUR_DONE_KEY) === '1'
}

const tourDone = ref(readDone())

export function markTourDone() {
  tourDone.value = true
  if (typeof localStorage !== 'undefined') localStorage.setItem(TOUR_DONE_KEY, '1')
}

export function resetTourDone() {
  tourDone.value = false
  if (typeof localStorage !== 'undefined') localStorage.removeItem(TOUR_DONE_KEY)
}

export function useTourState() {
  return { tourDone, markTourDone, resetTourDone }
}
