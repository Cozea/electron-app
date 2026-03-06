import type { FileUIPart } from 'ai'

export interface ChatAttachmentContext {
  pagePath?: string
  pageFile?: string
  projectName?: string
  serverPort?: number
}

export interface ChatComposerAttachment {
  type: 'image' | 'file'
  data: string
  name: string
  mediaType: string
  size?: number
  context?: ChatAttachmentContext
}

export interface ChatAttachmentSupport {
  images: boolean
  pdf: boolean
}

interface AttachmentCapabilitiesLike {
  supportsImageInput?: boolean
  supportsPdfInput?: boolean
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error(`Failed to read "${file.name}" as a data URL.`))
    }

    reader.onerror = () => {
      reject(reader.error ?? new Error(`Failed to read "${file.name}".`))
    }

    reader.readAsDataURL(file)
  })
}

function inferMediaTypeFromName(name: string): string {
  const normalized = name.trim().toLowerCase()
  if (normalized.endsWith('.pdf')) return 'application/pdf'
  if (normalized.endsWith('.png')) return 'image/png'
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg'
  if (normalized.endsWith('.webp')) return 'image/webp'
  if (normalized.endsWith('.gif')) return 'image/gif'
  if (normalized.endsWith('.bmp')) return 'image/bmp'
  if (normalized.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

function normalizeMediaType(file: File): string {
  if (typeof file.type === 'string' && file.type.trim().length > 0) {
    return file.type.trim()
  }

  return inferMediaTypeFromName(file.name)
}

function isSupportedMediaType(mediaType: string, support: ChatAttachmentSupport): boolean {
  const normalized = mediaType.toLowerCase()
  if (normalized.startsWith('image/')) return support.images
  if (normalized === 'application/pdf') return support.pdf
  return false
}

export function resolveChatAttachmentSupport(
  capabilities: AttachmentCapabilitiesLike | null | undefined
): ChatAttachmentSupport {
  if (!capabilities) {
    return {
      images: true,
      pdf: true,
    }
  }

  return {
    images: capabilities.supportsImageInput === true,
    pdf: capabilities.supportsPdfInput === true,
  }
}

export function getChatAttachmentAccept(
  support: ChatAttachmentSupport
): string | undefined {
  const accepted: string[] = []

  if (support.images) accepted.push('image/*')
  if (support.pdf) accepted.push('application/pdf')

  return accepted.length > 0 ? accepted.join(',') : undefined
}

export function describeSupportedChatAttachments(
  support: ChatAttachmentSupport
): string {
  if (support.images && support.pdf) return 'images and PDFs'
  if (support.images) return 'images'
  if (support.pdf) return 'PDFs'
  return 'attachments'
}

export async function fileListToChatComposerAttachments(
  files: FileList | File[],
  support: ChatAttachmentSupport
): Promise<{
  attachments: ChatComposerAttachment[]
  rejected: string[]
}> {
  const attachments: ChatComposerAttachment[] = []
  const rejected: string[] = []

  for (const file of Array.from(files)) {
    const mediaType = normalizeMediaType(file)
    if (!isSupportedMediaType(mediaType, support)) {
      rejected.push(file.name || 'Unnamed file')
      continue
    }

    try {
      const data = await fileToDataUrl(file)
      attachments.push({
        type: mediaType.toLowerCase().startsWith('image/') ? 'image' : 'file',
        data,
        name: file.name || 'Untitled attachment',
        mediaType,
        size: Number.isFinite(file.size) ? file.size : undefined,
      })
    } catch {
      rejected.push(file.name || 'Unnamed file')
    }
  }

  return { attachments, rejected }
}

export function chatComposerAttachmentToFilePart(
  attachment: ChatComposerAttachment
): FileUIPart {
  return {
    type: 'file',
    mediaType: attachment.mediaType,
    filename: attachment.name,
    url: attachment.data,
  }
}

export function hasFilesInDataTransfer(
  dataTransfer: DataTransfer | null | undefined
): boolean {
  if (!dataTransfer) return false
  return Array.from(dataTransfer.types).includes('Files')
}

export function buildAttachmentRejectionMessage(
  rejected: string[],
  support: ChatAttachmentSupport
): string {
  if (rejected.length === 0) return ''

  const supported = describeSupportedChatAttachments(support)
  if (!support.images && !support.pdf) {
    return 'The selected model does not accept file attachments.'
  }

  if (rejected.length === 1) {
    return `Could not attach "${rejected[0]}". This model currently supports ${supported}.`
  }

  return `Could not attach ${rejected.length} files. This model currently supports ${supported}.`
}
