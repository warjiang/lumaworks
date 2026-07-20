export const XHS_SELECTORS = {
  version: '2026-07-19',
  fileInput: ['input[type="file"][accept*="video"]', 'input[type="file"]'],
  title: ['input[placeholder*="标题"]', 'input.d-text', '[contenteditable="true"][data-placeholder*="标题"]'],
  description: ['textarea[placeholder*="正文"]', '[contenteditable="true"][data-placeholder*="正文"]', '.ql-editor'],
  publish: ['button.publishBtn', 'button[class*="publish"]', '[role="button"][class*="publish"]'],
} as const

export function pickSelector(document: Document, candidates: readonly string[]): string | null {
  return candidates.find((selector) => document.querySelector(selector)) ?? null
}
