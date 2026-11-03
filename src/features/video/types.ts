export type KeySlot = 'doubaoVideo' | 'hailuoVideo'
export type VideoProtocol = 'doubao' | 'hailuo-h3'
export interface VideoRoute { protocol: VideoProtocol; createPath: string; queryPath: string }
export type InputMode = 'frames' | 'reference'
export type AssetRole = 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio'
export type MediaType = 'image' | 'video' | 'audio'
export interface VideoInput { assetId: string; role: AssetRole }
export interface VideoParams {
  duration: number
  resolution: string
  ratio: string
  generate_audio?: boolean
  watermark?: boolean
  return_last_frame?: boolean
  output_format?: 'mp4' | 'mov'
}
export interface VideoDraft {
  id: 'main'
  prompt: string
  modelId: string
  inputMode: InputMode
  frames: VideoInput[]
  references: VideoInput[]
  params: VideoParams
  groupId: string | null
  retryOfTaskId?: string
}
export interface VideoAsset {
  id: string
  name: string
  mediaType: MediaType
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
  duration?: number
  remoteUrl?: string
  createdAt: number
}
export type GenerationState = 'unknown' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired'
export interface VideoTask {
  id: string
  gatewayTaskId?: string
  modelId: string
  keySlot: KeySlot
  credentialRevision: string
  gatewayBaseUrl: string
  route?: VideoRoute                 // 提交时快照；旧记录无此字段时保持原 Doubao 路由
  proxy: boolean
  prompt: string
  inputMode: InputMode
  inputs: VideoInput[]
  params: VideoParams
  submissionState: 'submitting' | 'submitted' | 'submit_unknown' | 'rejected'
  status: GenerationState
  rawStatus?: string
  syncState: 'syncing' | 'paused' | 'auth_required' | 'error'
  error?: string
  videoUrl?: string
  lastFrameUrl?: string
  actualParams?: Record<string, unknown>
  resultAccessError?: string
  resultUrlUpdatedAt?: number
  groupId: string | null
  isFavorite: boolean
  downloadedAt?: number
  downloadSource?: 'single' | 'batch' | 'zip' | 'manual'
  retryOfTaskId?: string
  createdAt: number
  updatedAt: number
  lastSyncedAt?: number
  resultSyncAttempts?: number
}
export interface VideoCredential { apiKey: string; remember: boolean; revision: string }
export interface VideoSettings {
  gatewayBaseUrl: string
  submitTimeoutSeconds?: number
  proxy: boolean
  routes?: Record<KeySlot, VideoRoute>
  doubaoVideo: VideoCredential
  hailuoVideo: VideoCredential
}
