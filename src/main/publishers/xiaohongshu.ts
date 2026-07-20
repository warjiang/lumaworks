import { BrowserWindow, session } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PublishDraft } from '@shared/domain'
import type { PublisherAdapter, PublishMedia, PublishResult, PublishStatus } from './types'
import { XHS_SELECTORS } from './xiaohongshu-selectors'

const CREATOR_URL = 'https://creator.xiaohongshu.com'
const PUBLISH_URL = `${CREATOR_URL}/publish/publish`

export class XiaohongshuPublisher implements PublisherAdapter {
  readonly platform = 'xiaohongshu' as const
  private window: BrowserWindow | null = null
  constructor(private readonly diagnosticsDir: string) {}

  async connect(): Promise<{ connected: boolean; message: string }> {
    const window = this.getWindow(); await window.loadURL(CREATOR_URL); window.show()
    return { connected: false, message: '请在打开的小红书创作中心完成登录。登录状态会保存在本机。' }
  }

  async validate(draft: PublishDraft, media: PublishMedia): Promise<string[]> {
    const errors: string[] = []
    if (!media.videoPath) errors.push('缺少视频文件')
    if (draft.title.length > 20) errors.push('小红书标题建议不超过 20 个汉字')
    if (draft.description.length > 1000) errors.push('小红书正文不能超过 1000 个字符')
    const cookies = await session.fromPartition('persist:xiaohongshu').cookies.get({ domain: '.xiaohongshu.com' })
    if (!cookies.length) errors.push('小红书尚未登录')
    return errors
  }

  async publish(draft: PublishDraft, media: PublishMedia): Promise<PublishResult> {
    try { return await this.performPublish(draft, media) }
    catch (error) {
      const window = this.window; const stamp = new Date().toISOString().replaceAll(':', '-')
      await mkdir(this.diagnosticsDir, { recursive: true })
      if (window && !window.isDestroyed()) {
        await window.webContents.executeJavaScript(`(() => { const style=document.createElement('style'); style.id='lumaworks-redact'; style.textContent='img,[class*=avatar],[class*=user],[class*=account]{filter:blur(14px)!important}'; document.head.appendChild(style) })()`).catch(() => undefined)
        await window.webContents.capturePage().then((image) => image.toPNG()).then((bytes) => writeFile(join(this.diagnosticsDir, `xiaohongshu-${stamp}.png`), bytes)).catch(() => undefined)
        await window.webContents.executeJavaScript(`document.getElementById('lumaworks-redact')?.remove()`).catch(() => undefined)
      }
      await writeFile(join(this.diagnosticsDir, `xiaohongshu-${stamp}.json`), JSON.stringify({ selectorVersion: XHS_SELECTORS.version, url: window?.webContents.getURL(), message: error instanceof Error ? error.message : String(error), capturedAt: new Date().toISOString() }, null, 2))
      throw error
    }
  }

  private async performPublish(draft: PublishDraft, media: PublishMedia): Promise<PublishResult> {
    const errors = await this.validate(draft, media); if (errors.length) throw new Error(errors.join('；'))
    const window = this.getWindow(); await window.loadURL(PUBLISH_URL); window.show(); await this.waitForReady(window)
    const contents = window.webContents
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    try {
      const { root } = await contents.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true }) as { root: { nodeId: number } }
      let inputNodeId = 0
      for (const selector of XHS_SELECTORS.fileInput) {
        const found = await contents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector }) as { nodeId: number }
        if (found.nodeId) { inputNodeId = found.nodeId; break }
      }
      if (!inputNodeId) throw new Error(`没有找到视频上传控件（选择器版本 ${XHS_SELECTORS.version}）`)
      await contents.debugger.sendCommand('DOM.setFileInputFiles', { files: [media.videoPath], nodeId: inputNodeId })
      const payload = JSON.stringify({ title: draft.title, description: `${draft.description}\n${draft.tags.map((tag) => `#${tag}`).join(' ')}`.trim(), titleSelectors: XHS_SELECTORS.title, descriptionSelectors: XHS_SELECTORS.description, publishSelectors: XHS_SELECTORS.publish })
      const result = await contents.executeJavaScript(`(() => {
        const p = ${payload};
        const setValue = (selectors, value) => {
          const el = selectors.map((s) => document.querySelector(s)).find(Boolean);
          if (!el) return false;
          el.focus();
          if ('value' in el) el.value = value; else el.textContent = value;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };
        const text = document.body.innerText || '';
        if (/验证码|安全验证|滑块/.test(text)) return { captcha: true };
        return { title: setValue(p.titleSelectors, p.title), description: setValue(p.descriptionSelectors, p.description), captcha: false };
      })()` ) as { title: boolean; description: boolean; captcha: boolean }
      if (result.captcha) throw new Error('检测到安全验证，已暂停并等待人工处理')
      if (!result.title || !result.description) throw new Error(`页面字段发生变化（选择器版本 ${XHS_SELECTORS.version}），已保留窗口供人工完成`)
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3_000))
        const submit = await contents.executeJavaScript(`(() => {
          const text = document.body.innerText || '';
          if (/验证码|安全验证|滑块/.test(text)) return 'captcha';
          const button = ${JSON.stringify(XHS_SELECTORS.publish)}.map((s) => document.querySelector(s)).find(Boolean);
          if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return 'waiting';
          button.click(); return 'clicked';
        })()` ) as 'captcha' | 'waiting' | 'clicked'
        if (submit === 'captcha') throw new Error('检测到安全验证，已暂停并等待人工处理')
        if (submit === 'clicked') break
        if (attempt === 119) throw new Error('等待视频上传完成超时，已保留窗口供人工完成')
      }
      return { externalId: `xhs-assisted-${Date.now()}`, status: 'processing' }
    } finally { if (contents.debugger.isAttached()) contents.debugger.detach() }
  }

  async status(): Promise<PublishStatus> { return { status: 'processing' } }

  private getWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    this.window = new BrowserWindow({ width: 1180, height: 820, show: false, title: '小红书创作中心', webPreferences: { partition: 'persist:xiaohongshu', sandbox: true, contextIsolation: true, nodeIntegration: false } })
    this.window.on('closed', () => { this.window = null })
    return this.window
  }

  private async waitForReady(window: BrowserWindow): Promise<void> {
    await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 8_000); window.webContents.once('did-finish-load', () => { clearTimeout(timer); setTimeout(resolve, 1_500) }) })
  }
}
