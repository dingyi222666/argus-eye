import screenshot from 'screenshot-desktop'
import type { DisplayInfo } from './protocol'

export interface CaptureOptions {
    display?: number | string
    format?: 'png' | 'jpg'
}

export async function listDisplays(): Promise<DisplayInfo[]> {
    type RawDisplay = {
        id: number | string
        name?: string
        width?: number
        height?: number
        primary?: boolean
        dpiScale?: number
    }
    const raw = (await screenshot.listDisplays()) as RawDisplay[]
    return raw.map((d) => ({
        id: d.id,
        name: d.name,
        width: d.width,
        height: d.height,
        primary: d.primary
    }))
}

export async function capture(options: CaptureOptions = {}): Promise<{
    buffer: Buffer
    mime: string
    display?: number | string
}> {
    const format = options.format ?? 'jpg'
    const mime = format === 'png' ? 'image/png' : 'image/jpeg'

    type ScreenshotOptions = {
        format?: 'png' | 'jpg'
        screen?: number | string
    }
    const opts: ScreenshotOptions = { format }
    if (options.display !== undefined) {
        opts.screen = options.display
    }

    type ScreenshotFn = (opts: ScreenshotOptions) => Promise<Buffer>
    const buffer = await (screenshot as unknown as ScreenshotFn)(opts)
    return { buffer, mime, display: options.display }
}
