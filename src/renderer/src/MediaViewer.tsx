import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
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

export function MediaViewer({ preview, onClose }: { preview: MediaPreview; onClose(): void }) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number } | null>(null)
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const reset = (): void => { setScale(1); setRotation(0); setOffset({ x: 0, y: 0 }) }
  const zoom = (factor: number): void => setScale((current) => {
    const next = clampScale(current * factor)
    if (next <= 1) setOffset({ x: 0, y: 0 })
    return next
  })

  useEffect(() => { reset() }, [preview.path])
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
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); setRotation((value) => value + 90) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, preview.kind])

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (preview.kind !== 'image') return
    event.preventDefault()
    zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12)
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (preview.kind !== 'image' || event.button !== 0 || scale <= 1) return
    drag.current = { pointerId: event.pointerId, x: offset.x, y: offset.y, startX: event.clientX, startY: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    setOffset({ x: current.x + event.clientX - current.startX, y: current.y + event.clientY - current.startY })
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <div className="media-viewer" role="dialog" aria-modal="true" aria-label={`${preview.title}预览`} ref={viewerRef} tabIndex={-1}>
    <header className="media-viewer-header">
      <div><strong>{preview.title}</strong><span>{preview.kind === 'image' ? '关键帧' : '镜头视频'}</span></div>
      <div className="media-viewer-actions">
        {preview.kind === 'image' && <>
          <button type="button" onClick={() => zoom(1 / 1.2)} aria-label="缩小" title="缩小 (-)"><MagnifyingGlassMinus /></button>
          <output aria-live="polite">{scale === 1 ? '适合窗口' : `${Math.round(scale * 100)}%`}</output>
          <button type="button" onClick={() => zoom(1.2)} aria-label="放大" title="放大 (+)"><MagnifyingGlassPlus /></button>
          <button type="button" onClick={() => setRotation((value) => value + 90)} aria-label="顺时针旋转" title="旋转 (R)"><ArrowCounterClockwise className="rotate-clockwise" /></button>
          <button type="button" onClick={reset} aria-label="适合窗口" title="适合窗口 (0)"><ArrowsOut /></button>
        </>}
        <button type="button" onClick={() => void window.lumaworks.revealPath(preview.path)} aria-label="在 Finder 中显示" title="在 Finder 中显示"><FolderOpen /></button>
        <button type="button" className="media-viewer-close" onClick={onClose} aria-label="关闭预览" title="关闭 (Esc)"><X /></button>
      </div>
    </header>
    <div
      className={`media-viewer-stage ${preview.kind === 'image' ? `is-image ${scale > 1 ? 'can-pan' : ''}` : 'is-video'}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={preview.kind === 'image' ? reset : undefined}
    >
      <div className="media-viewer-fit">
        {preview.kind === 'image'
          ? <img src={preview.src} alt={preview.title} draggable={false} style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) rotate(${rotation}deg) scale(${scale})` }} />
          : <video src={preview.src} controls autoPlay playsInline preload="metadata" />}
      </div>
    </div>
    {preview.kind === 'image' && <footer className="media-viewer-hint">滚轮缩放 · 拖动查看 · 双击重置 · Esc 关闭</footer>}
  </div>
}
