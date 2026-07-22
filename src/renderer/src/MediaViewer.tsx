import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import {
  ArrowCounterClockwise, ArrowsOut, FolderOpen, MagnifyingGlassMinus,
  MagnifyingGlassPlus, X,
} from '@phosphor-icons/react'

export interface MediaPreview {
  kind: 'image' | 'video'
  path: string
  src: string
  title: string
}

const MIN_SCALE = 0.25
const MAX_SCALE = 5
const clampScale = (value: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))

interface ViewState { scale: number; x: number; y: number }
const FIT_VIEW: ViewState = { scale: 1, x: 0, y: 0 }

interface StageGeometry { naturalW: number; naturalH: number; fitW: number; fitH: number; contain: number }

export function MediaViewer({ preview, onClose }: { preview: MediaPreview; onClose(): void }) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number } | null>(null)
  const geometry = useRef<StageGeometry | null>(null)
  const [view, setView] = useState<ViewState>(FIT_VIEW)
  const [rotation, setRotation] = useState(0)
  const [naturalRatio, setNaturalRatio] = useState(1)

  const reset = useCallback((): void => { setView(FIT_VIEW); setRotation(0) }, [])

  /** Keep at least a strip of the image reachable instead of letting it fly off-stage. */
  const clampView = useCallback((candidate: ViewState): ViewState => {
    const geo = geometry.current
    if (!geo || candidate.scale <= 1) return { scale: candidate.scale, x: 0, y: 0 }
    const contentW = geo.naturalW * geo.contain * candidate.scale
    const contentH = geo.naturalH * geo.contain * candidate.scale
    const margin = 80
    const maxX = Math.max(0, (contentW - geo.fitW) / 2 + margin)
    const maxY = Math.max(0, (contentH - geo.fitH) / 2 + margin)
    return { scale: candidate.scale, x: Math.max(-maxX, Math.min(maxX, candidate.x)), y: Math.max(-maxY, Math.min(maxY, candidate.y)) }
  }, [])

  /** Scale needed to show the image at its true pixels (fit is object-contain). */
  const measureNaturalRatio = useCallback((): void => {
    const img = imgRef.current; const stage = stageRef.current
    if (!img || !stage || !img.naturalWidth || !img.naturalHeight) { setNaturalRatio(1); return }
    const box = stage.getBoundingClientRect()
    const fitW = Math.max(1, box.width - 52); const fitH = Math.max(1, box.height - 52)
    const contain = Math.min(fitW / img.naturalWidth, fitH / img.naturalHeight)
    geometry.current = { naturalW: img.naturalWidth, naturalH: img.naturalHeight, fitW, fitH, contain }
    setNaturalRatio(Math.min(MAX_SCALE, Math.max(1, 1 / contain)))
  }, [preview.path])

  /** Zoom so the content point under the cursor stays fixed on screen. */
  const zoomAtPoint = useCallback((factor: number, clientX: number, clientY: number): void => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const px = clientX - (rect.left + rect.width / 2)
    const py = clientY - (rect.top + rect.height / 2)
    setView((current) => {
      const next = clampScale(current.scale * factor)
      // Sub-fit scales just center the (smaller) image; panning only makes
      // sense once the content overflows the stage.
      if (next <= 1) return { scale: next, x: 0, y: 0 }
      const qx = (px - current.x) / current.scale
      const qy = (py - current.y) / current.scale
      return clampView({ scale: next, x: px - qx * next, y: py - qy * next })
    })
  }, [])

  const zoom = useCallback((factor: number): void => {
    const rect = stageRef.current?.getBoundingClientRect()
    zoomAtPoint(factor, rect ? rect.left + rect.width / 2 : 0, rect ? rect.top + rect.height / 2 : 0)
  }, [zoomAtPoint])

  const showActualPixels = useCallback((): void => {
    setView((current) => ({ scale: naturalRatio, x: Math.min(0, current.x), y: Math.min(0, current.y) }))
  }, [naturalRatio])

  useEffect(() => { setView(FIT_VIEW); setRotation(0); setNaturalRatio(1) }, [preview.path])
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    viewerRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [preview.path])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      if (preview.kind !== 'image') return
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2) }
      if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2) }
      if (event.key === '0') { event.preventDefault(); reset() }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); setRotation((value) => value + 90); setView(FIT_VIEW) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, preview.kind, zoom, reset])

  // Native wheel listener: React registers onWheel as passive, which silently
  // drops preventDefault and lets the page behind the modal scroll.
  // Trackpad model (Figma/Maps-style): pinch (ctrl+wheel) = zoom at cursor,
  // two-finger scroll = pan the zoomed image. Plain mouse-wheel notches do
  // nothing — accidental scrolls must not zoom the image.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || preview.kind !== 'image') return
    const onWheel = (event: globalThis.WheelEvent): void => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        zoomAtPoint(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY)
        return
      }
      const trackpadPan = event.deltaX !== 0 || (event.deltaMode === 0 && Math.abs(event.deltaY) < 50)
      if (trackpadPan) {
        setView((current) => current.scale > 1 ? clampView({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }) : current)
      }
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [preview.kind, zoomAtPoint, clampView])

  useEffect(() => {
    const onResize = (): void => measureNaturalRatio()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measureNaturalRatio])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (preview.kind !== 'image' || event.button !== 0 || view.scale <= 1) return
    event.preventDefault()
    drag.current = { pointerId: event.pointerId, x: view.x, y: view.y, startX: event.clientX, startY: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    setView((value) => clampView({ ...value, x: current.x + event.clientX - current.startX, y: current.y + event.clientY - current.startY }))
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (preview.kind !== 'image') return
    if (view.scale > 1) { setView(FIT_VIEW); return }
    zoomAtPoint(Math.min(Math.max(naturalRatio, 1.8), 3) / view.scale, event.clientX, event.clientY)
  }

  const zoomPercent = view.scale === 1 ? '适合窗口' : `${Math.round(view.scale * 100)}%`

  return <div className="media-viewer" role="dialog" aria-modal="true" aria-label={`${preview.title}预览`} ref={viewerRef} tabIndex={-1}>
    <header className="media-viewer-header">
      <div><strong>{preview.title}</strong><span>{preview.kind === 'image' ? '关键帧' : '镜头视频'}</span></div>
      <div className="media-viewer-actions">
        {preview.kind === 'image' && <>
          <button type="button" onClick={() => zoom(1 / 1.2)} aria-label="缩小" title="缩小 (-)"><MagnifyingGlassMinus /></button>
          <output aria-live="polite">{zoomPercent}</output>
          <button type="button" onClick={() => zoom(1.2)} aria-label="放大" title="放大 (+)"><MagnifyingGlassPlus /></button>
          <button type="button" onClick={showActualPixels} aria-label="实际像素" title="实际像素 (1:1)">1:1</button>
          <button type="button" onClick={() => { setRotation((value) => value + 90); setView(FIT_VIEW) }} aria-label="顺时针旋转" title="旋转 (R)"><ArrowCounterClockwise className="rotate-clockwise" /></button>
          <button type="button" onClick={reset} aria-label="适合窗口" title="适合窗口 (0)"><ArrowsOut /></button>
        </>}
        <button type="button" onClick={() => void window.lumaworks.revealPath(preview.path)} aria-label="在 Finder 中显示" title="在 Finder 中显示"><FolderOpen /></button>
        <button type="button" className="media-viewer-close" onClick={onClose} aria-label="关闭预览" title="关闭 (Esc)"><X /></button>
      </div>
    </header>
    <div
      ref={stageRef}
      className={`media-viewer-stage ${preview.kind === 'image' ? `is-image ${view.scale > 1 ? 'can-pan' : ''}` : 'is-video'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <div className="media-viewer-fit">
        {preview.kind === 'image'
          ? <img ref={imgRef} src={preview.src} alt={preview.title} draggable={false} onLoad={measureNaturalRatio} style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) rotate(${rotation}deg) scale(${view.scale})` }} />
          : <video src={preview.src} controls autoPlay playsInline preload="metadata" />}
      </div>
    </div>
    {preview.kind === 'image' && <footer className="media-viewer-hint">双指捏合缩放 · 双指滑动或拖拽平移 · 双击放大/还原 · 1:1 实际像素 · Esc 关闭</footer>}
  </div>
}
