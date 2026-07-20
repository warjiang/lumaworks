import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { shell } from 'electron'
import type { SecretStore } from './secrets'

async function waitForCode(buildUrl: (redirectUri: string, state: string) => string): Promise<{ code: string; redirectUri: string }> {
  const state = randomBytes(20).toString('hex')
  return await new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
      if (url.searchParams.get('state') !== state) { response.writeHead(400).end('State mismatch'); return }
      const code = url.searchParams.get('code')
      if (!code) { response.writeHead(400).end('Missing authorization code'); return }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<h2>LumaWorks 已连接，可以关闭此窗口。</h2>')
      const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}/callback`
      clearTimeout(timer); server.close(); resolve({ code, redirectUri })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}/callback`
      void shell.openExternal(buildUrl(redirectUri, state))
    })
    timer = setTimeout(() => { server.close(); reject(new Error('OAuth 登录超时')) }, 5 * 60_000)
  })
}

export class OAuthService {
  constructor(private readonly secrets: SecretStore) {}

  async connectYouTube(): Promise<void> {
    const clientId = this.secrets.get('youtubeClientId'); const clientSecret = this.secrets.get('youtubeClientSecret')
    if (!clientId || !clientSecret) throw new Error('请先配置 YouTube Client ID 和 Client Secret')
    const { code, redirectUri } = await waitForCode((redirect, state) => {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube', access_type: 'offline', prompt: 'consent', state }).toString()
      return url.toString()
    })
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }) })
    const body = await response.json() as { access_token?: string; refresh_token?: string; error_description?: string }
    if (!response.ok || !body.access_token) throw new Error(body.error_description ?? 'Google OAuth 失败')
    this.secrets.set('youtubeAccessToken', body.access_token); if (body.refresh_token) this.secrets.set('youtubeRefreshToken', body.refresh_token)
  }

  async connectTikTok(): Promise<void> {
    const clientKey = this.secrets.get('tiktokClientKey'); const clientSecret = this.secrets.get('tiktokClientSecret')
    if (!clientKey || !clientSecret) throw new Error('请先配置 TikTok Client Key 和 Client Secret')
    const { code, redirectUri } = await waitForCode((redirect, state) => {
      const url = new URL('https://www.tiktok.com/v2/auth/authorize/')
      url.search = new URLSearchParams({ client_key: clientKey, redirect_uri: redirect, response_type: 'code', scope: 'user.info.basic,video.publish,video.upload', state }).toString()
      return url.toString()
    })
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }) })
    const body = await response.json() as { access_token?: string; error_description?: string }
    if (!response.ok || !body.access_token) throw new Error(body.error_description ?? 'TikTok OAuth 失败')
    this.secrets.set('tiktokAccessToken', body.access_token)
  }
}
