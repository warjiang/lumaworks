import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowClockwise, ArrowRight, ArrowsOutSimple, CheckCircle, FilmReel, FolderOpen, GearSix, ImageSquare, MagicWand,
  Pause, PencilSimple, Play, Plus, RocketLaunch, SlidersHorizontal, SpeakerHigh, SpinnerGap, Stack, Subtitles,
  UploadSimple, Users, VideoCamera, WarningCircle, X,
} from '@phosphor-icons/react'
import type { CharacterVoice, ContentLocale, DashboardSnapshot, DiagnosticEvent, EnqueueJobInput, Job, JobDetails, ModelTestKind, ModelTestResult, Platform, Project, ProjectStage, SaveSettingsInput, Shot, VoicePresetId } from '@shared/domain'
import { VOICE_PRESETS, voicePreset } from '@shared/voices'
import { MediaViewer, type MediaPreview } from './MediaViewer'

type View = 'studio' | 'publish' | 'settings'

const STAGES: Array<{ id: ProjectStage; label: string }> = [
  { id: 'concept', label: '故事' }, { id: 'script', label: '剧本' }, { id: 'assets', label: '定妆' },
  { id: 'storyboard', label: '分镜' }, { id: 'video', label: '视频' }, { id: 'render', label: '成片' }, { id: 'publish', label: '发布' },
]

const STAGE_ORDER = new Map(STAGES.map((stage, index) => [stage.id, index]))
const initialSnapshot: DashboardSnapshot = { projects: [], activeProject: null, jobs: [], publishDrafts: [], renders: [], configured: { ark: false, speech: false, tiktok: false, youtube: false }, modelSettings: { arkTextModel: 'doubao-seed-2-1-turbo-260628', arkTextApi: 'responses', arkTextStream: true, seedreamModel: 'doubao-seedream-5-0-pro-260628', seedanceModel: 'doubao-seedance-2-0-fast-260128', speechResourceId: 'seed-tts-2.0', speechVoiceId: 'zh_female_vv_uranus_bigtts', speechEnglishVoiceId: 'en_female_dacey_uranus_bigtts' } }

function formatTime(value: string): string { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' }).format(new Date(value)) }
function formatDuration(milliseconds: number): string { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` }
function mediaUrl(path: string, version?: string): string { return `luma-media://local${encodeURI(path)}${version ? `?v=${encodeURIComponent(version)}` : ''}` }
function jobLabel(job: Job): string { return ({ 'story-bible': '启动故事圣经', 'story-foundation': '故事基底', 'story-characters': '角色设定', 'story-locations': '场景设定', 'story-episodes': '分集大纲', 'story-bible-assemble': '合并故事圣经', 'episode-script': '分镜剧本', 'shot-image': '关键帧', 'shot-grid-image': '宫格关键帧', 'shot-video': '镜头视频', 'dialogue-timing': '对白规划', 'voice-line': '角色配音', 'translate-episode': '英文改写', 'render-episode': '合成成片', publish: '平台投稿', 'character-image': '角色定妆', 'location-image': '场景设定图' } as Record<string, string>)[job.type] ?? job.type }

function groupShotsForGrid(shots: Shot[]): { groups: string[][]; singles: string[] } {
  const groups: string[][] = []; const singles: string[] = []; let buffer: Shot[] = []
  const drain = () => { while (buffer.length >= 4) groups.push(buffer.splice(0, 4).map((shot) => shot.id)); singles.push(...buffer.map((shot) => shot.id)); buffer = [] }
  for (const shot of shots) {
    const location = shot.direction?.location ?? ''
    if (buffer.length && (buffer[0].direction?.location ?? '') !== location) drain()
    buffer.push(shot)
  }
  drain()
  return { groups, singles }
}

export function App() {
  const [data, setData] = useState<DashboardSnapshot>(initialSnapshot)
  const [view, setView] = useState<View>('studio')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newProject, setNewProject] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async (projectId?: string) => {
    try { setData(await window.lumaworks.getDashboard(projectId)); setError(null) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void refresh()
    const unsubscribe = window.lumaworks.onJobEvent((job) => {
      setData((current) => { const previous = current.jobs.find((item) => item.id === job.id); if (previous && previous.updatedAt > job.updatedAt) return current; return { ...current, jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)] } })
      if (job.status === 'completed') {
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => void refresh(), 250)
      }
    })
    return () => { unsubscribe(); if (refreshTimer.current) clearTimeout(refreshTimer.current) }
  }, [refresh])

  const enqueue = async (input: EnqueueJobInput) => {
    try { await window.lumaworks.enqueueJob(input); await refresh(data.activeProject?.id) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }

  const enqueueMany = async (inputs: EnqueueJobInput[]) => {
    try { await Promise.all(inputs.map((input) => window.lumaworks.enqueueJob(input))); await refresh(data.activeProject?.id) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="traffic-space" />
        <div className="brand"><div className="brand-mark">L</div><span>LumaWorks</span></div>
        <nav className="main-nav" aria-label="主导航">
          <NavButton active={view === 'studio'} icon={<FilmReel />} label="制作台" onClick={() => setView('studio')} />
          <NavButton active={view === 'publish'} icon={<RocketLaunch />} label="投稿" onClick={() => setView('publish')} />
          <NavButton active={view === 'settings'} icon={<GearSix />} label="设置" onClick={() => setView('settings')} />
        </nav>
        <div className="project-switcher">
          <div className="section-label"><span>项目</span><button className="icon-button" onClick={() => setNewProject(true)} aria-label="新建项目"><Plus /></button></div>
          <div className="project-list">
            {data.projects.map((project) => <button key={project.id} className={`project-item ${project.id === data.activeProject?.id ? 'active' : ''}`} onClick={() => void refresh(project.id)}><span className="project-thumb"><FilmReel /></span><span><strong>{project.title}</strong><small>{project.stage === 'publish' ? '待发布' : STAGES.find((item) => item.id === project.stage)?.label}</small></span></button>)}
            {!data.projects.length && <p className="sidebar-empty">创建第一个短剧项目</p>}
          </div>
        </div>
        <div className="sidebar-footer"><ConnectionBadge ok={data.configured.ark} label="火山方舟" /><ConnectionBadge ok={data.configured.speech} label="火山语音" /></div>
      </aside>

      <main className="main-area">
        {error && <div className="error-banner"><WarningCircle /><span>{error}</span><button onClick={() => setError(null)}><X /></button></div>}
        {loading ? <LoadingState /> : view === 'studio' ? <Studio data={data} enqueue={enqueue} enqueueMany={enqueueMany} onNew={() => setNewProject(true)} refresh={() => refresh(data.activeProject?.id)} /> : view === 'publish' ? <PublishCenter data={data} refresh={() => refresh(data.activeProject?.id)} setError={setError} /> : <Settings data={data} refresh={() => refresh(data.activeProject?.id)} setError={setError} />}
      </main>

      <JobsRail jobs={data.jobs} activeProjectId={data.activeProject?.id} onOpen={setSelectedJobId} onCancel={(id) => void window.lumaworks.cancelJob(id)} onRetry={async (id) => { await window.lumaworks.retryJob(id); await refresh(data.activeProject?.id) }} />
      {selectedJobId && <TaskDetailsDrawer jobId={selectedJobId} onClose={() => setSelectedJobId(null)} />}
      {newProject && <NewProjectDialog onClose={() => setNewProject(false)} onCreated={async (id) => { setNewProject(false); await refresh(id) }} />}
    </div>
  )
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick(): void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span></button>
}

function ConnectionBadge({ ok, label }: { ok: boolean; label: string }) { return <div className={`connection ${ok ? 'ok' : ''}`}><span className="state-dot" /><span>{label}</span><small>{ok ? '已配置' : '未配置'}</small></div> }

function Studio({ data, enqueue, enqueueMany, onNew, refresh }: { data: DashboardSnapshot; enqueue(input: EnqueueJobInput): Promise<void>; enqueueMany(inputs: EnqueueJobInput[]): Promise<void>; onNew(): void; refresh(): void }) {
  const [preview, setPreview] = useState<MediaPreview | null>(null)
  const [editingProject, setEditingProject] = useState(false)
  const project = data.activeProject
  if (!project) return <EmptyStudio onNew={onNew} />
  const episode = project.episodes[0]
  const stageIndex = STAGE_ORDER.get(project.stage) ?? 0
  const activeJobs = data.jobs.filter((job) => ['queued', 'running', 'waiting'].includes(job.status)).length
  const videoJobsActive = data.jobs.some((job) => job.projectId === project.id && job.type === 'shot-video' && ['queued', 'running', 'waiting'].includes(job.status))
  const referencedCharacters = project.characters.filter((character) => character.referenceAssetId).length
  const batch = async (type: 'shot-image' | 'shot-video') => {
    if (type === 'shot-image') return enqueueMany(project.shots.map((shot) => ({ type, entityId: shot.id, payload: {}, force: true })))
    const batchScheduledAt = new Date().toISOString()
    return enqueueMany(project.shots.map((shot) => shot.imagePath
      ? { type: 'shot-video', entityId: shot.id, payload: {}, scheduledAt: batchScheduledAt, force: false }
      : { type: 'shot-image', entityId: shot.id, payload: { continueToVideo: true, batchScheduledAt }, scheduledAt: batchScheduledAt, force: false }))
  }
  const batchGrid = async () => {
    if (!episode) return
    const pending = project.shots.filter((shot) => !shot.imagePath)
    // No missing keyframes means the click is a "redo everything in grid mode".
    const targets = pending.length ? pending : project.shots
    if (!targets.length) return
    const { groups, singles } = groupShotsForGrid(targets)
    return enqueueMany([
      ...groups.map((shotIds) => ({ type: 'shot-grid-image' as const, entityId: episode.id, payload: { shotIds }, force: true })),
      ...singles.map((shotId) => ({ type: 'shot-image' as const, entityId: shotId, payload: {}, force: true })),
    ])
  }
  return <div className="workspace">
    <header className="workspace-header">
      <div><p className="muted">短剧项目</p><h1>{project.title}</h1></div>
      <div className="header-actions"><span className="running-count"><SpinnerGap className={activeJobs ? 'spin' : ''} />{activeJobs ? `${activeJobs} 个任务进行中` : '任务空闲'}</span><button className="secondary-button" onClick={() => void window.lumaworks.openProjectDirectory(project.id)} title="在 Finder 中打开当前项目的素材目录"><FolderOpen />工作目录</button><button className="secondary-button" onClick={refresh}><ArrowClockwise />刷新</button></div>
    </header>
    <div className="stage-track" aria-label="制作阶段">
      {STAGES.map((stage, index) => <div key={stage.id} className={`stage-node ${index < stageIndex ? 'done' : ''} ${index === stageIndex ? 'current' : ''}`}><span>{index < stageIndex ? <CheckCircle weight="fill" /> : index + 1}</span><strong>{stage.label}</strong></div>)}
    </div>
    <section className="concept-strip">
      <div><span className="section-kicker">创作设定</span><p>{project.synopsis}</p></div>
      <dl><div><dt>画幅</dt><dd>9:16</dd></div><div><dt>风格</dt><dd>{project.visualStyle}</dd></div><div><dt>目标</dt><dd>60-90 秒</dd></div></dl>
      <button type="button" className="icon-button concept-edit" onClick={() => setEditingProject(true)} aria-label="编辑项目设定" title="编辑名称、梗概与视觉风格"><PencilSimple /></button>
    </section>
    <section className="action-board">
      <div className="board-heading"><div><h2>制作流程</h2><p>每一步都可以审核、重做或继续推进。</p></div></div>
      <div className="action-grid">
        <ActionBlock icon={<MagicWand />} title="故事圣经" description="建立角色、世界观、视觉方向与分集悬念。" status={stageIndex > 0 ? 'ready' : 'next'} action="生成故事" onClick={() => enqueue({ type: 'story-bible', entityId: project.id, payload: {}, force: true })} />
        <ActionBlock icon={<Stack />} title="分镜剧本" description="生成 8-16 个镜头、动作提示词和对白时间轴。" status={episode ? 'ready' : stageIndex > 0 ? 'next' : 'locked'} action="生成剧本" onClick={() => enqueue({ type: 'episode-script', entityId: project.id, payload: { episodeNumber: 1 }, force: true })} />
        <ActionBlock icon={<Users />} title="角色定妆" description={`${referencedCharacters}/${project.characters.length || 0} 个角色已有定妆参考照，关键帧会据此保持人物一致`} status={project.characters.length ? referencedCharacters >= project.characters.length ? 'working' : 'next' : 'locked'} action="生成定妆照" onClick={() => enqueueMany(project.characters.map((character) => ({ type: 'character-image' as const, entityId: character.id, payload: { projectId: project.id }, force: referencedCharacters >= project.characters.length })))} />
        <ActionBlock icon={<ImageSquare />} title="关键帧" description={`${project.shots.filter((shot) => shot.imagePath).length}/${project.shots.length || 0} 个镜头已生成；宫格模式同场景 4 镜一图，风格更统一`} status={project.shots.some((shot) => shot.imagePath) ? 'working' : episode ? 'next' : 'locked'} action="批量生图" onClick={() => batch('shot-image')} extra={{ label: '宫格生图', onClick: () => void batchGrid() }} />
        <ActionBlock icon={<VideoCamera />} title="镜头视频" description={`${project.shots.filter((shot) => shot.videoPath).length}/${project.shots.length || 0} 个镜头已完成；缺失关键帧会自动接续生成`} status={project.shots.some((shot) => shot.videoPath) ? 'working' : episode ? 'next' : 'locked'} action="流水线生视频" onClick={() => batch('shot-video')} />
      </div>
    </section>
    {!!project.characters.length && <CharacterVoices characters={project.characters} onSaved={refresh} />}
    {!!project.gridAssets.length && <section className="grid-assets-section"><div className="board-heading"><div><h2>宫格合图</h2><p>每张合图同版切出 4 个镜头的关键帧；点击看大图，对比同版镜头的色调与光影是否一致。</p></div><span>{project.gridAssets.length} 版</span></div><div className="grid-assets">{project.gridAssets.map((asset) => <button type="button" key={asset.id} className="grid-asset-thumb" onClick={() => setPreview({ kind: 'image', path: asset.path, src: mediaUrl(asset.path, asset.createdAt), title: `宫格合图 · ${formatTime(asset.createdAt)}` })} aria-label="查看宫格合图大图"><img src={mediaUrl(asset.path, asset.createdAt)} alt="" /></button>)}</div></section>}
    {!!project.shots.length && <section className="shots-section"><div className="board-heading"><div><h2>镜头板</h2><p>点击关键帧查看大图；已有视频的镜头可直接播放预览。</p></div><span>{project.shots.length} 镜</span></div><div className="shots-grid">{project.shots.map((shot) => { const imageUrl = shot.imagePath ? mediaUrl(shot.imagePath, shot.updatedAt) : null; const videoUrl = shot.videoPath ? mediaUrl(shot.videoPath, shot.updatedAt) : null; return <article className="shot-card" key={shot.id}><div className="shot-media">{shot.imagePath && imageUrl ? <button type="button" className="shot-image-preview" onClick={() => setPreview({ kind: 'image', path: shot.imagePath!, src: imageUrl, title: shot.title })} aria-label={`查看${shot.title}关键帧大图`}><img src={imageUrl} alt="" /><span className="shot-media-affordance"><ArrowsOutSimple />查看大图</span></button> : <ImageSquare />}{shot.videoPath && videoUrl && <button type="button" className="shot-video-preview" onClick={() => setPreview({ kind: 'video', path: shot.videoPath!, src: videoUrl, title: shot.title })} aria-label={`播放${shot.title}视频`} title="播放视频"><Play weight="fill" /></button>}</div><div className="shot-copy"><div className="shot-meta"><small>镜头 {String(shot.position).padStart(2, '0')}</small><span>{shot.durationSeconds} 秒</span></div><h3>{shot.title}</h3><p>{shot.description}</p><div className="shot-actions"><button onClick={() => enqueue({ type: 'shot-image', entityId: shot.id, payload: {}, force: true })}><ImageSquare />{shot.imagePath ? '重做图' : '生图'}</button><button disabled={!shot.imagePath} onClick={() => enqueue({ type: 'shot-video', entityId: shot.id, payload: {}, force: true })}><VideoCamera />{shot.videoPath ? '重做视频' : '生视频'}</button></div></div></article> })}</div></section>}
    {episode && <section className="finishing-bar"><div><Subtitles /><span><strong>声音与交付</strong><small>{project.dialoguePlans.length ? project.dialoguePlans.map((plan) => `${plan.locale === 'zh-CN' ? '中文' : '英文'}：${plan.status === 'voiced' ? '配音就绪' : plan.status === 'ready' ? '时间轴就绪' : '需重新规划'}`).join(' · ') : '视频完成后先规划对白，再生成配音和字幕'}</small></span></div><div className="finishing-actions"><button disabled={videoJobsActive || !project.shots.length || project.shots.some((shot) => !shot.videoPath)} onClick={() => enqueue({ type: 'dialogue-timing', entityId: episode.id, payload: { locale: 'zh-CN', continueToVoice: true }, force: true })}>规划并生成中文配音</button><button onClick={() => enqueue({ type: 'translate-episode', entityId: episode.id, payload: {}, force: true })}>英文改写</button><button disabled={videoJobsActive || !project.shots.length || project.shots.some((shot) => !shot.videoPath)} onClick={() => enqueue({ type: 'dialogue-timing', entityId: episode.id, payload: { locale: 'en-US', continueToVoice: true }, force: true })}>规划并生成英文配音</button><button className="primary-button" onClick={() => enqueue({ type: 'render-episode', entityId: episode.id, payload: { locale: 'zh-CN' }, force: true })}><Play weight="fill" />渲染中文</button><button className="primary-button" onClick={() => enqueue({ type: 'render-episode', entityId: episode.id, payload: { locale: 'en-US' }, force: true })}><Play weight="fill" />渲染英文</button></div></section>}
    {preview && <MediaViewer preview={preview} onClose={() => setPreview(null)} />}
    {editingProject && <EditProjectDialog project={project} onClose={() => setEditingProject(false)} onSaved={() => { setEditingProject(false); refresh() }} />}
  </div>
}

function CharacterVoices({ characters, onSaved }: { characters: CharacterVoice[]; onSaved(): void }) {
  const [reassigning, setReassigning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const projectId = characters[0]?.projectId
  const reassign = async () => {
    if (!projectId) return
    setReassigning(true); setMessage(null)
    try { const result = await window.lumaworks.reassignCharacterVoices(projectId); setMessage(`已按故事设定重新分配 ${result.changed} 个角色音色，配音需重新生成`); onSaved() }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setReassigning(false) }
  }
  return <section className="voice-section"><div className="board-heading"><div><h2>角色音色</h2><p>系统按角色设定预分配中英文音色，可逐角色修改并试听；人工保存会锁定，「重新分配」按故事圣经重推并解除锁定。</p>{message && <p className="field-help">{message}</p>}</div><div className="voice-actions"><span>{characters.length} 角色</span><button type="button" disabled={reassigning || !projectId} onClick={() => void reassign()} title="按故事圣经中的角色设定重新推断全部角色音色（覆盖人工锁定）">{reassigning ? <SpinnerGap className="spin" /> : <ArrowClockwise />}重新分配音色</button></div></div><div className="voice-table"><div className="voice-table-head"><span>角色</span><span>策略</span><span>中文 Voice ID</span><span>英文 Voice ID</span><span>操作</span></div>{characters.map((character) => <CharacterVoiceRow key={character.id} character={character} onSaved={onSaved} />)}</div></section>
}

function CharacterVoiceRow({ character, onSaved }: { character: CharacterVoice; onSaved(): void }) {
  const [preset, setPreset] = useState<VoicePresetId>(character.voicePreset)
  const [zhVoiceId, setZhVoiceId] = useState(character.zhVoiceId)
  const [enVoiceId, setEnVoiceId] = useState(character.enVoiceId)
  const [busy, setBusy] = useState<ContentLocale | 'save' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const choosePreset = (value: VoicePresetId) => { const selected = voicePreset(value); setPreset(value); setZhVoiceId(selected.zhVoiceId); setEnVoiceId(selected.enVoiceId); setMessage(null) }
  const save = async () => { setBusy('save'); setMessage(null); try { await window.lumaworks.updateCharacterVoice({ id: character.id, voicePreset: preset, zhVoiceId, enVoiceId, voiceLocked: true }); setMessage('已保存'); onSaved() } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(null) } }
  const preview = async (locale: ContentLocale) => { setBusy(locale); setMessage(null); try { await window.lumaworks.updateCharacterVoice({ id: character.id, voicePreset: preset, zhVoiceId, enVoiceId, voiceLocked: true }); const result = await window.lumaworks.previewCharacterVoice(character.id, locale); const audio = new Audio(mediaUrl(result.path, String(Date.now()))); await audio.play(); setMessage(result.warning ?? (locale === 'zh-CN' ? '正在播放中文试听' : '正在播放英文试听')); onSaved() } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(null) } }
  const reference = async () => { setBusy('save'); setMessage(null); try { await window.lumaworks.enqueueJob({ type: 'character-image', entityId: character.id, payload: { projectId: character.projectId }, force: true }); setMessage(character.referenceAssetId ? '正在重新生成定妆照' : '正在生成定妆照'); onSaved() } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(null) } }
  const persistedWarning = [character.zhVoiceWarning, character.enVoiceWarning].filter(Boolean).join('；')
  const status = message ?? persistedWarning
  return <div className="voice-row"><div className="voice-character"><strong>{character.name}</strong><span>{character.role}</span></div><label><span className="sr-only">音色策略</span><select value={preset} onChange={(event) => choosePreset(event.target.value as VoicePresetId)}>{VOICE_PRESETS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label><span className="sr-only">中文 Voice ID</span><input value={zhVoiceId} onChange={(event) => setZhVoiceId(event.target.value)} /></label><label><span className="sr-only">英文 Voice ID</span><input value={enVoiceId} onChange={(event) => setEnVoiceId(event.target.value)} /></label><div className="voice-actions"><button type="button" disabled={busy !== null} onClick={() => void preview('zh-CN')} title="试听中文"><SpeakerHigh />中</button><button type="button" disabled={busy !== null} onClick={() => void preview('en-US')} title="试听英文"><SpeakerHigh />英</button><button type="button" disabled={busy !== null} onClick={() => void reference()} title={character.referenceAssetId ? '已有定妆照，点击重新生成' : '生成角色定妆参考照，供关键帧保持人物一致'}><ImageSquare />{character.referenceAssetId ? '重拍' : '定妆'}</button><button type="button" disabled={busy !== null || !zhVoiceId.trim() || !enVoiceId.trim()} onClick={() => void save()}>{busy === 'save' ? <SpinnerGap className="spin" /> : null}保存</button>{status && <small className={persistedWarning && !message ? 'warning' : ''} title={status}>{status}</small>}</div></div>
}

function ActionBlock({ icon, title, description, status, action, onClick, extra }: { icon: React.ReactNode; title: string; description: string; status: 'ready' | 'next' | 'working' | 'locked'; action: string; onClick(): void; extra?: { label: string; onClick(): void } }) {
  return <article className={`action-block ${status}`}><div className="action-icon">{icon}</div><div><h3>{title}</h3><p>{description}</p></div><div className="action-buttons">{extra && <button disabled={status === 'locked'} onClick={extra.onClick}><Stack />{extra.label}</button>}<button disabled={status === 'locked'} onClick={onClick}>{status === 'ready' ? <ArrowClockwise /> : <ArrowRight />}{status === 'ready' ? `重新${action}` : action}</button></div></article>
}

function PublishCenter({ data, refresh, setError }: { data: DashboardSnapshot; refresh(): void; setError(value: string | null): void }) {
  const [formOpen, setFormOpen] = useState(false)
  const [preview, setPreview] = useState<MediaPreview | null>(null)
  const completed = data.renders.filter((render) => render.status === 'completed')
  const connect = async (platform: Platform) => { try { const result = await window.lumaworks.connectPlatform(platform); if (!result.connected) setError(result.message); await refresh() } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } }
  return <div className="page-view"><header className="page-header"><div><p className="muted">渠道交付</p><h1>投稿中心</h1><p>审核每个平台的成片、封面与文案，再进入发布队列。</p></div><button className="primary-button" disabled={!completed.length} onClick={() => setFormOpen(true)}><UploadSimple />新建投稿</button></header>
    <div className="platform-row"><PlatformCard name="小红书" detail="浏览器辅助投稿" connected label="打开登录" onClick={() => connect('xiaohongshu')} /><PlatformCard name="TikTok" detail="Content Posting API" connected={data.configured.tiktok} label="连接账号" onClick={() => connect('tiktok')} /><PlatformCard name="YouTube" detail="Data API 断点上传" connected={data.configured.youtube} label="连接账号" onClick={() => connect('youtube')} /></div>
    {!!completed.length && <section className="publish-list"><div className="board-heading"><div><h2>成片预览</h2><p>最终交付文件为 final.mp4（含环境音、配音与烧录字幕）；目录中的 master.mp4 是未配音的中间产物，请勿直接播放。</p></div></div>{completed.map((render) => <article className="publish-item" key={render.id}><div className="platform-symbol"><Play weight="fill" /></div><div className="publish-copy"><strong>{render.locale === 'zh-CN' ? '中文版成片' : '英文版成片'}</strong><span>{formatTime(render.createdAt)}</span></div><button className="secondary-button" disabled={!render.videoPath} onClick={() => setPreview({ kind: 'video', path: render.videoPath!, src: mediaUrl(render.videoPath!, render.createdAt), title: render.locale === 'zh-CN' ? '中文版成片' : '英文版成片' })}><Play weight="fill" />播放</button></article>)}</section>}
    <section className="publish-list"><div className="board-heading"><div><h2>待审核与发布</h2><p>只有确认后的草稿才会真正提交。</p></div></div>{data.publishDrafts.length ? data.publishDrafts.map((draft) => <article className="publish-item" key={draft.id}><div className={`platform-symbol ${draft.platform}`}>{draft.platform === 'xiaohongshu' ? '小' : draft.platform === 'tiktok' ? 'T' : 'Y'}</div><div className="publish-copy"><strong>{draft.title}</strong><span>{draft.platform} · {draft.scheduledAt ? formatTime(draft.scheduledAt) : '立即发布'} · {draft.visibility}</span></div><div className="publish-tags">{draft.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div><button className={draft.approved ? 'secondary-button' : 'primary-button'} disabled={draft.approved} onClick={async () => { await window.lumaworks.approvePublishDraft(draft.id); refresh() }}>{draft.approved ? '已入队' : '审核并发布'}</button></article>) : <div className="empty-inline"><UploadSimple /><p>还没有投稿草稿。先完成一版成片。</p></div>}</section>
    {formOpen && <PublishDialog renders={completed} onClose={() => setFormOpen(false)} onCreated={async () => { setFormOpen(false); refresh() }} />}
    {preview && <MediaViewer preview={preview} onClose={() => setPreview(null)} />}
  </div>
}

function PlatformCard({ name, detail, connected, label, onClick }: { name: string; detail: string; connected: boolean; label: string; onClick(): void }) { return <article className="platform-card"><div><strong>{name}</strong><span>{detail}</span></div><span className={`connection-label ${connected ? 'ok' : ''}`}>{connected ? '已连接' : '未连接'}</span><button onClick={onClick}>{label}<ArrowRight /></button></article> }

function Settings({ data, refresh, setError }: { data: DashboardSnapshot; refresh(): void; setError(value: string | null): void }) {
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState<ModelTestKind | null>(null)
  const [testResults, setTestResults] = useState<Partial<Record<ModelTestKind, ModelTestResult>>>({})
  const formRef = useRef<HTMLFormElement>(null)
  const valuesFromForm = (): SaveSettingsInput => Object.fromEntries([...new FormData(formRef.current!).entries()].map(([key, value]) => [key, String(value)])) as unknown as SaveSettingsInput
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await window.lumaworks.saveSettings(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])) as never); setSaved(true); setTimeout(() => setSaved(false), 2500); refresh() } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } }
  const testModel = async (kind: ModelTestKind) => {
    if (!formRef.current) return
    setTesting(kind); setError(null)
    try {
      await window.lumaworks.saveSettings(valuesFromForm())
      const result = await window.lumaworks.testModel(kind)
      setTestResults((current) => ({ ...current, [kind]: result }))
      await refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setTesting(null) }
  }
  return <div className="page-view settings-page"><header className="page-header"><div><p className="muted">本地配置</p><h1>模型与平台</h1><p>凭据使用系统安全存储加密。测试会真实调用模型，并返回耗时与样例结果。</p></div></header><form ref={formRef} onSubmit={submit} className="settings-form">
    <SettingsGroup title="火山方舟" description="Doubao Seed、Seedream 与 Seedance 共用一个方舟 API Key。"><Field label="API Key" name="arkApiKey" type="password" placeholder={data.configured.ark ? '已保存，留空则不修改' : '输入 ARK API Key'} /><div className="field-row"><Field label="文本模型" name="arkTextModel" defaultValue={data.modelSettings.arkTextModel} /><Field label="图片模型" name="seedreamModel" defaultValue={data.modelSettings.seedreamModel} /><Field label="视频模型" name="seedanceModel" defaultValue={data.modelSettings.seedanceModel} /></div><div className="field-row two"><SelectField label="文本 API" name="arkTextApi" defaultValue={data.modelSettings.arkTextApi} options={[['responses', 'Responses API（推荐）'], ['chat-completions', 'Chat Completions（兼容）']]} /><SelectField label="Responses 输出" name="arkTextStream" defaultValue={String(data.modelSettings.arkTextStream)} options={[['true', '流式 SSE'], ['false', '非流式 JSON']]} /></div><p className="field-help">结构化剧本默认调用 /api/v3/responses。基础模型测试不启用 web_search 工具。</p><div className="model-test-row"><ModelTestButton kind="text" label="测试文本" running={testing} onClick={testModel} /><ModelTestButton kind="image" label="测试生图" running={testing} onClick={testModel} /><ModelTestButton kind="video" label="测试视频" hint="生成测试图和 4 秒视频，会产生费用" running={testing} onClick={testModel} /></div><ModelTestResults kinds={['text', 'image', 'video']} results={testResults} /></SettingsGroup>
    <SettingsGroup title="豆包语音合成 2.0" description="使用官方 /api/v3/tts/unidirectional；凭据独立于火山方舟。">
      <div className="speech-guide"><strong>配置方法</strong><ol><li>推荐在新版豆包语音控制台创建 API Key，只填写下方 API Key。</li><li>旧版控制台可继续使用 App ID + Access Token 双头鉴权。</li><li>标准音色使用资源 ID seed-tts-2.0；声音复刻 2.0 使用 seed-icl-2.0。</li></ol><a href="https://console.volcengine.com/speech/new/setting/apikeys?projectName=default" target="_blank" rel="noreferrer">打开豆包语音 API Key 管理 <ArrowRight /></a></div>
      <div className="field-row two"><Field label="API Key（新版，推荐）" name="speechApiKey" type="password" placeholder={data.configured.speech ? '已保存时可留空' : '新版控制台 API Key'} /><Field label="资源 ID" name="speechResourceId" defaultValue={data.modelSettings.speechResourceId} /></div>
      <div className="field-row two"><Field label="App ID（旧版兼容）" name="speechAppId" placeholder="旧版语音应用 App ID" /><Field label="Access Token（旧版兼容）" name="speechAccessToken" type="password" placeholder={data.configured.speech ? '已保存时可留空' : '旧版语音应用 Access Token'} /></div>
      <div className="field-row two"><Field label="中文 Voice ID" name="speechVoiceId" defaultValue={data.modelSettings.speechVoiceId} /><Field label="英文 Voice ID" name="speechEnglishVoiceId" defaultValue={data.modelSettings.speechEnglishVoiceId} /></div><p className="field-help">中文默认使用官方示例音色 zh_female_vv_uranus_bigtts；英文默认使用 en_female_dacey_uranus_bigtts。测试会同时验证语音指令 context_texts 和 MP3 流式分片解析。</p><div className="model-test-row"><ModelTestButton kind="speech" label="测试并试听" running={testing} onClick={testModel} /></div><ModelTestResults kinds={['speech']} results={testResults} />
    </SettingsGroup>
    <SettingsGroup title="海外平台" description="个人版使用你自己的开发者应用。可以通过 OAuth 连接，也可以直接保存 Access Token。"><div className="field-row two"><Field label="TikTok Client Key" name="tiktokClientKey" /><Field label="TikTok Client Secret" name="tiktokClientSecret" type="password" /></div><Field label="TikTok Access Token" name="tiktokAccessToken" type="password" placeholder={data.configured.tiktok ? '已保存' : '可选，用于跳过 OAuth'} /><div className="field-row two"><Field label="YouTube Client ID" name="youtubeClientId" /><Field label="YouTube Client Secret" name="youtubeClientSecret" type="password" /></div><Field label="YouTube Access Token" name="youtubeAccessToken" type="password" placeholder={data.configured.youtube ? '已保存' : '可选，用于跳过 OAuth'} /></SettingsGroup>
    <div className="form-footer"><span>{saved && <><CheckCircle weight="fill" />配置已保存</>}</span><button className="primary-button" type="submit"><SlidersHorizontal />保存配置</button></div>
  </form><SystemDiagnostics /></div>
}

function SettingsGroup({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <section className="settings-group"><div><h2>{title}</h2><p>{description}</p></div><div className="settings-fields">{children}</div></section> }
function Field({ label, name, type = 'text', placeholder, defaultValue }: { label: string; name: string; type?: string; placeholder?: string; defaultValue?: string }) { return <label className="field"><span>{label}</span><input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} autoComplete="off" /></label> }
function SelectField({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: Array<[string, string]> }) { return <label className="field"><span>{label}</span><select name={name} defaultValue={defaultValue}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label> }

function ModelTestButton({ kind, label, hint, running, onClick }: { kind: ModelTestKind; label: string; hint?: string; running: ModelTestKind | null; onClick(kind: ModelTestKind): void }) {
  const busy = running === kind
  return <div className="model-test-action"><button type="button" disabled={running !== null} onClick={() => onClick(kind)}>{busy ? <SpinnerGap className="spin" /> : <Play weight="fill" />}{busy ? '测试中' : label}</button>{hint && <small>{hint}</small>}</div>
}

function ModelTestResults({ kinds, results }: { kinds: ModelTestKind[]; results: Partial<Record<ModelTestKind, ModelTestResult>> }) {
  return <>{kinds.map((kind) => { const result = results[kind]; if (!result) return null
    const requestId = typeof result.requestId === 'string' && result.requestId ? result.requestId : '旧版结果'
    const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : []
    const elapsedSeconds = Number.isFinite(result.elapsedMs) ? (result.elapsedMs / 1000).toFixed(1) : '未知'
    const diagnosticText = JSON.stringify({ requestId, kind: result.kind ?? kind, model: result.model, ok: result.ok, message: result.message, diagnostics }, null, 2)
    return <article className={`model-test-result ${result.ok ? 'success' : 'failure'}`} key={kind}><div className="test-result-head">{result.ok ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}<div><strong>{result.ok ? '测试通过' : '测试失败'}</strong><span>{result.model} · {elapsedSeconds} 秒 · {requestId === '旧版结果' ? requestId : requestId.slice(0, 8)}</span></div></div><p>{result.message}</p>{result.previewText && <blockquote>{result.previewText}</blockquote>}{result.outputPath && kind === 'image' && <img src={mediaUrl(result.outputPath)} alt="Seedream 测试结果" />}{result.outputPath && kind === 'video' && <video src={mediaUrl(result.outputPath)} controls />}{result.outputPath && kind === 'speech' && <audio src={mediaUrl(result.outputPath)} controls />}
      <details className="diagnostic-details"><summary>诊断日志（{diagnostics.length} 条）</summary><div className="diagnostic-toolbar"><button type="button" onClick={() => void navigator.clipboard.writeText(diagnosticText)}>复制日志</button>{result.logPath && <button type="button" onClick={() => void window.lumaworks.revealPath(result.logPath)}>在 Finder 中打开</button>}</div>{diagnostics.length ? <div className="diagnostic-list">{diagnostics.map((entry, index) => <div className={`diagnostic-entry ${entry.level}`} key={`${entry.timestamp}-${index}`}><span>{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</span><strong>{entry.phase}</strong><p>{entry.message}</p>{entry.details && <pre>{JSON.stringify(entry.details, null, 2)}</pre>}</div>)}</div> : <p>当前结果来自旧版主进程，没有结构化日志。请完全退出应用后重新运行 pnpm dev。</p>}</details>
      {result.outputPath && <button type="button" className="reveal-button" onClick={() => void window.lumaworks.revealPath(result.outputPath!)}>查看测试素材</button>}</article>
  })}</>
}

function JobsRail({ jobs, activeProjectId, onOpen, onCancel, onRetry }: { jobs: Job[]; activeProjectId?: string; onOpen(id: string): void; onCancel(id: string): void; onRetry(id: string): void }) {
  const [scope, setScope] = useState<'project' | 'all'>('project')
  const [status, setStatus] = useState<'all' | 'active' | 'failed' | 'completed'>('all')
  const [, setClock] = useState(0)
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const scoped = jobs.filter((job) => scope === 'all' || !activeProjectId || job.projectId === activeProjectId)
  const visible = scoped.filter((job) => status === 'all' || status === 'active' && ['queued', 'running', 'waiting'].includes(job.status) || job.status === status).slice(0, 30)
  return <aside className="jobs-rail"><div className="jobs-title"><span>任务队列</span><small>{scoped.filter((job) => ['queued', 'running', 'waiting'].includes(job.status)).length}</small></div><div className="jobs-filters"><select value={scope} onChange={(event) => setScope(event.target.value as 'project' | 'all')}><option value="project">当前项目</option><option value="all">全部项目</option></select><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="active">执行中</option><option value="failed">失败</option><option value="completed">已完成</option></select></div><div className="jobs-list">{visible.map((job) => {
    const started = job.startedAt ? new Date(job.startedAt).getTime() : new Date(job.createdAt).getTime(); const stale = job.status === 'running' && Boolean(job.heartbeatAt) && Date.now() - new Date(job.heartbeatAt!).getTime() > 30_000
    return <article className={`job-card ${job.status}`} key={job.id} onClick={() => onOpen(job.id)}><div className="job-top"><span>{job.status === 'running' ? <SpinnerGap className="spin" /> : job.status === 'completed' ? <CheckCircle weight="fill" /> : job.status === 'failed' ? <WarningCircle weight="fill" /> : <Pause />}</span><div><strong>{jobLabel(job)}</strong><small>{job.status === 'running' ? formatDuration(Date.now() - started) : formatTime(job.updatedAt)} · 第 {Math.max(1, job.attempts)} 次</small></div></div><div className="job-phase">{stale ? '任务可能失去响应' : job.currentMessage ?? job.currentPhase ?? job.status}</div>{job.status === 'running' && <div className={`job-progress ${job.progressMode === 'indeterminate' ? 'indeterminate' : ''}`}><span style={job.progressMode === 'determinate' ? { width: `${job.progress}%` } : undefined} /></div>}{job.status === 'queued' && job.currentPhase === 'job.retry_scheduled' && <div className="job-retry">{new Date(job.scheduledAt).getTime() > Date.now() ? `${Math.ceil((new Date(job.scheduledAt).getTime() - Date.now()) / 1000)} 秒后重试` : '即将重试'}</div>}{job.error && <p>{job.error}</p>}<div className="job-buttons">{['queued', 'running'].includes(job.status) && <button onClick={(event) => { event.stopPropagation(); onCancel(job.id) }}>取消</button>}{job.status === 'failed' && <button onClick={(event) => { event.stopPropagation(); onRetry(job.id) }}>重试</button>}</div></article>
  })}{!visible.length && <div className="jobs-empty"><Stack /><span>没有匹配的任务</span></div>}</div></aside>
}

function TaskDetailsDrawer({ jobId, onClose }: { jobId: string; onClose(): void }) {
  const [details, setDetails] = useState<JobDetails | null>(null)
  const [technical, setTechnical] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void window.lumaworks.getJobDetails(jobId).then((value) => { if (active) setDetails(value) }, (error) => setMessage(error instanceof Error ? error.message : String(error)))
    const offLog = window.lumaworks.onDiagnosticEvent((entry) => { if (entry.jobId !== jobId) return; setDetails((current) => current ? { ...current, events: [...current.events.filter((item) => item.id !== entry.id), entry].sort((a, b) => a.sequence - b.sequence) } : current) })
    const offJob = window.lumaworks.onJobEvent((job) => { if (job.id === jobId) setDetails((current) => current ? { ...current, job } : current) })
    return () => { active = false; offLog(); offJob() }
  }, [jobId])
  const events = (details?.events ?? []).filter((entry) => technical || !entry.phase.startsWith('http.') && !entry.phase.endsWith('.body'))
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside className="task-drawer"><header><div><small>任务详情</small><h2>{details ? jobLabel(details.job) : '加载中'}</h2></div><button onClick={onClose}><X /></button></header>{message && <p className="form-error">{message}</p>}{details && <><section className="task-summary"><span className={`task-status ${details.job.status}`}>{details.job.status}</span><strong>{details.job.currentMessage ?? details.job.currentPhase}</strong><small>尝试 {details.job.attempts}/{details.job.maxAttempts} · 创建于 {formatTime(details.job.createdAt)}</small>{details.job.error && <p>{details.job.error}</p>}</section><div className="drawer-toolbar"><button className={!technical ? 'active' : ''} onClick={() => setTechnical(false)}>执行时间线</button><button className={technical ? 'active' : ''} onClick={() => setTechnical(true)}>技术日志</button><button onClick={() => void window.lumaworks.exportJobDiagnostics(jobId)}>导出诊断包</button></div><div className="task-timeline">{events.map((entry) => <article className={`timeline-event ${entry.level}`} key={entry.id}><span className="timeline-dot" /><div><div className="timeline-head"><strong>{entry.message}</strong><time>{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</time></div><small>第 {entry.attempt ?? 0} 次 · {entry.phase}</small>{entry.progress?.mode === 'determinate' && <p>{entry.progress.current !== undefined && entry.progress.total !== undefined ? `${entry.progress.current}/${entry.progress.total} ${entry.progress.unit ?? ''}` : `${Math.round(entry.progress.value ?? 0)}%`}</p>}{entry.details && <details><summary>查看详情{entry.payloadAvailable ? '（已加密保存）' : ''}</summary><pre>{JSON.stringify(entry.details, null, 2)}</pre><button onClick={() => void navigator.clipboard.writeText(JSON.stringify(entry.details, null, 2))}>复制详情</button></details>}</div></article>)}{!events.length && <div className="jobs-empty"><SpinnerGap className="spin" /><span>等待任务事件</span></div>}</div></>}</aside></div>
}

function SystemDiagnostics() {
  const [events, setEvents] = useState<DiagnosticEvent[]>([])
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all')
  const load = useCallback(() => { void window.lumaworks.listSystemEvents({ level: level === 'all' ? undefined : level, limit: 100 }).then(setEvents) }, [level])
  useEffect(() => { load(); return window.lumaworks.onDiagnosticEvent((entry) => { if (!entry.jobId && (level === 'all' || entry.level === level)) setEvents((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 100)) }) }, [load, level])
  return <section className="system-diagnostics"><div className="board-heading"><div><h2>系统诊断</h2><p>主进程、数据库、IPC 与渲染进程的本地日志。</p></div><div className="diagnostic-toolbar"><select value={level} onChange={(event) => setLevel(event.target.value as typeof level)}><option value="all">全部级别</option><option value="warn">警告</option><option value="error">错误</option></select><button type="button" onClick={() => { void window.lumaworks.clearDiagnostics().then(() => setEvents([])) }}>清空日志</button></div></div><div className="diagnostic-list">{events.map((entry) => <div className={`diagnostic-entry ${entry.level}`} key={entry.id}><span>{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</span><strong>{entry.phase}</strong><p>{entry.message}</p>{entry.details && <pre>{JSON.stringify(entry.details, null, 2)}</pre>}</div>)}{!events.length && <div className="jobs-empty"><Stack /><span>暂无系统日志</span></div>}</div></section>
}

const VISUAL_STYLE_PRESETS: Array<{ label: string; value: string; hint: string }> = [
  { label: '漫剧动漫', value: '日式动漫画风，现代都市漫剧，赛璐璐上色，色彩明快', hint: '推荐：AI 面孔不会被误判为真人，视频过审率最高' },
  { label: '写实电影', value: 'cinematic realism, contemporary Chinese drama', hint: '照片级人脸极易触发 Seedance 真人审核，导致视频生成被拒' },
]

function EditProjectDialog({ project, onClose, onSaved }: { project: Project; onClose(): void; onSaved(): void }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null)
  const [visualStyle, setVisualStyle] = useState(project.visualStyle)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true)
    const form = new FormData(event.currentTarget)
    try { await window.lumaworks.updateProject({ id: project.id, title: String(form.get('title')), synopsis: String(form.get('synopsis')), visualStyle }); onSaved() }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : String(caught)); setBusy(false) }
  }
  return <div className="dialog-backdrop" role="presentation"><form className="dialog" onSubmit={submit}><button className="dialog-close" type="button" onClick={onClose}><X /></button><p className="muted">项目设定</p><h2>调整故事与风格</h2>
    <p className="dialog-copy">修改视觉风格后，需要依次重新生成故事圣经、角色定妆照与关键帧，旧的写实素材才会被替换。</p>
    <Field label="项目名称" name="title" defaultValue={project.title} />
    <label className="field"><span>故事梗概</span><textarea name="synopsis" required minLength={20} rows={6} defaultValue={project.synopsis} /></label>
    <div className="field"><span>视觉风格</span><div className="style-presets">{VISUAL_STYLE_PRESETS.map((preset) => <button type="button" key={preset.label} className={visualStyle === preset.value ? 'active' : ''} title={preset.hint} onClick={() => setVisualStyle(preset.value)}>{preset.label}</button>)}</div><input name="visualStyle" required value={visualStyle} onChange={(event) => setVisualStyle(event.target.value)} /><p className="field-help">照片级写实人脸会触发 Seedance「输入图片可能包含真实人物」审核；漫剧/动漫风格可稳定过审。</p></div>
    {message && <p className="form-error">{message}</p>}
    <button className="primary-button wide" disabled={busy}>{busy ? <SpinnerGap className="spin" /> : <CheckCircle weight="fill" />}{busy ? '正在保存' : '保存设定'}</button></form></div>
}

function NewProjectDialog({ onClose, onCreated }: { onClose(): void; onCreated(id: string): void }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { const id = await window.lumaworks.createProject({ title: String(form.get('title')), synopsis: String(form.get('synopsis')), visualStyle: String(form.get('visualStyle')) }); onCreated(id) } catch (caught) { setMessage(caught instanceof Error ? caught.message : String(caught)); setBusy(false) } }
  return <div className="dialog-backdrop" role="presentation"><form className="dialog" onSubmit={submit}><button className="dialog-close" type="button" onClick={onClose}><X /></button><p className="muted">创建短剧</p><h2>从一个故事钩子开始</h2><p className="dialog-copy">先写清人物、欲望与冲突。模型会把它展开为可制作的竖屏剧集。</p><Field label="项目名称" name="title" placeholder="例如：她在婚礼前消失了" /><label className="field"><span>故事梗概</span><textarea name="synopsis" required minLength={20} rows={7} placeholder="主角是谁，想得到什么，被什么阻碍，结尾要留下什么悬念？" /></label><Field label="视觉风格" name="visualStyle" defaultValue="日式动漫画风，现代都市漫剧，赛璐璐上色，色彩明快" />{message && <p className="form-error">{message}</p>}<button className="primary-button wide" disabled={busy}>{busy ? <SpinnerGap className="spin" /> : <MagicWand />}{busy ? '正在创建' : '创建项目'}</button></form></div>
}

function PublishDialog({ renders, onClose, onCreated }: { renders: DashboardSnapshot['renders']; onClose(): void; onCreated(): void }) {
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); const platforms = ['xiaohongshu', 'tiktok', 'youtube'].filter((platform) => form.get(platform)) as Platform[]; try { await window.lumaworks.createPublishDrafts({ renderId: String(form.get('renderId')), platforms, title: String(form.get('title')), description: String(form.get('description')), tags: String(form.get('tags')).split(/[,，\s]+/).filter(Boolean), coverPath: null, scheduledAt: form.get('scheduledAt') ? new Date(String(form.get('scheduledAt'))).toISOString() : null, visibility: String(form.get('visibility')) as 'public' | 'private' | 'unlisted' }); onCreated() } finally { setBusy(false) } }
  return <div className="dialog-backdrop"><form className="dialog publish-dialog" onSubmit={submit}><button className="dialog-close" type="button" onClick={onClose}><X /></button><p className="muted">发布审核</p><h2>准备渠道版本</h2><label className="field"><span>成片</span><select name="renderId">{renders.map((render) => <option key={render.id} value={render.id}>{render.locale === 'zh-CN' ? '中文版' : '英文版'} · {formatTime(render.createdAt)}</option>)}</select></label><div className="platform-checks"><label><input type="checkbox" name="xiaohongshu" defaultChecked />小红书</label><label><input type="checkbox" name="tiktok" />TikTok</label><label><input type="checkbox" name="youtube" />YouTube</label></div><Field label="标题" name="title" /><label className="field"><span>正文</span><textarea name="description" rows={4} /></label><Field label="标签" name="tags" placeholder="短剧 悬疑 AI影视" /><div className="field-row two"><Field label="定时发布" name="scheduledAt" type="datetime-local" /><label className="field"><span>可见性</span><select name="visibility"><option value="public">公开</option><option value="private">私密</option><option value="unlisted">不公开列出</option></select></label></div><button className="primary-button wide" disabled={busy}>{busy ? <SpinnerGap className="spin" /> : <UploadSimple />}{busy ? '正在创建' : '创建审核草稿'}</button></form></div>
}

function EmptyStudio({ onNew }: { onNew(): void }) { return <div className="empty-studio"><div className="empty-visual"><FilmReel /></div><p className="muted">本地 AI 短剧制作</p><h1>把故事做成第一集</h1><p>从梗概开始，逐步确认剧本、角色、分镜、配音与成片。</p><button className="primary-button" onClick={onNew}><Plus />新建短剧</button></div> }
function LoadingState() { return <div className="loading-state"><div className="skeleton wide" /><div className="skeleton" /><div className="skeleton grid" /></div> }
