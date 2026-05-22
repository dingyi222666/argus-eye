import { logger } from './logger'

/** 当前活动窗口的简要信息，无法获取时为 undefined。 */
export interface ActiveWindowInfo {
    app: string
    title: string
    bounds: { x: number; y: number; width: number; height: number }
    displayBounds?: { x: number; y: number; width: number; height: number }
}

type GetWindowsModule = {
    activeWindow: (opts?: {
        accessibilityPermission?: boolean
        screenRecordingPermission?: boolean
    }) => Promise<RawWindow | undefined>
}

interface RawWindow {
    title?: string
    bounds?: { x: number; y: number; width: number; height: number }
    contentBounds?: { x: number; y: number; width: number; height: number }
    owner?: { name?: string }
}

/**
 * 检测器：懒加载 `get-windows`（原生 npm 包，gyp 编译）。
 * 该模块在某些平台 / 环境（Wayland、CI 容器、缺乏权限的 macOS）上不可用，
 * 这种情况下返回 undefined，调用方按"无法判断"处理。
 */
export class FullscreenDetector {
    private mod?: GetWindowsModule
    private loading?: Promise<GetWindowsModule | undefined>
    private warnedFailure = false

    constructor(private enabled: boolean) {}

    setEnabled(enabled: boolean) {
        this.enabled = enabled
    }

    isEnabled() {
        return this.enabled
    }

    /**
     * 获取当前活动窗口。无法获取时返回 undefined。
     */
    async getActiveWindow(): Promise<ActiveWindowInfo | undefined> {
        if (!this.enabled) return undefined
        const mod = await this.load()
        if (!mod) return undefined
        try {
            const win = await mod.activeWindow({
                // 不要在 macOS 上触发权限弹窗
                accessibilityPermission: false,
                screenRecordingPermission: false
            })
            if (!win || !win.bounds) return undefined
            return {
                app: win.owner?.name ?? '',
                title: win.title ?? '',
                bounds: win.bounds
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.debug(`activeWindow failed: ${message}`)
            return undefined
        }
    }

    /**
     * 判断 `win` 是否在 `display` 上覆盖整块屏（全屏游戏 / 全屏视频 / 最大化应用）。
     *
     * 注意：`get-windows` 在 Windows 上返回的是 DPI 缩放后的逻辑像素，
     * `screenshot-desktop` 报告的是物理像素。所以比较的是缩放比例，
     * 该比例应该匹配某个常见的 DPI 缩放因子（100% / 125% / 150% / ...）。
     *
     * 这个检查会把"最大化的应用"也视作 fullscreen，这是有意为之 ——
     * 用户的意图是「看到某个独占应用就别曝光画面」。
     */
    isFullscreen(
        win: ActiveWindowInfo,
        display: { width?: number; height?: number }
    ) {
        if (!display.width || !display.height) return false
        const { bounds } = win
        if (bounds.width <= 0 || bounds.height <= 0) return false

        // window 对 display 的覆盖比例，宽高两个维度应当一致（DPI 等比缩放）。
        const widthRatio = bounds.width / display.width
        const heightRatio = bounds.height / display.height
        const ratioMismatch =
            Math.abs(widthRatio - heightRatio) /
            Math.max(widthRatio, heightRatio)
        if (ratioMismatch > 0.02) return false

        // 必须落在 Windows 常见 DPI 缩放对应的覆盖比例上。
        // 100% → 1.0, 125% → 0.8, 150% → 0.667, 175% → 0.571,
        // 200% → 0.5, 225% → 0.444, 250% → 0.4
        const scale = (widthRatio + heightRatio) / 2
        const dpiScales = [1.0, 0.8, 2 / 3, 4 / 7, 0.5, 4 / 9, 0.4]
        const matchesDpi = dpiScales.some((s) => Math.abs(scale - s) < 0.01)
        if (!matchesDpi) return false

        // 起点应贴近显示器原点（容错处理多屏 / 任务栏吃掉的几像素）。
        // 注意 logical px 与 physical px 的差异在原点附近基本可忽略。
        return Math.abs(bounds.x) <= 8 && Math.abs(bounds.y) <= 8
    }

    private load() {
        if (this.mod) return Promise.resolve(this.mod)
        if (this.loading) return this.loading
        this.loading = (async () => {
            try {
                // get-windows 是 ESM-only 包，dynamic import 才能用
                const mod = (await import('get-windows')) as GetWindowsModule
                this.mod = mod
                return mod
            } catch (err) {
                if (!this.warnedFailure) {
                    const message =
                        err instanceof Error ? err.message : String(err)
                    logger.warn(
                        `fullscreen detection unavailable: ${message}. ` +
                            `(get-windows failed to load; install it manually if you want this feature.)`
                    )
                    this.warnedFailure = true
                }
                return undefined
            }
        })()
        return this.loading
    }
}
