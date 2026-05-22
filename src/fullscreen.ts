import { logger } from './logger'

/** 当前活动窗口的简要信息，无法获取时为 undefined。 */
export interface ActiveWindowInfo {
    app: string
    title: string
    bounds: { x: number; y: number; width: number; height: number }
    contentBounds?: { x: number; y: number; width: number; height: number }
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
 * 默认的"允许截图"应用名（不区分大小写、子串匹配）。
 * 这些是即使全屏也是普通工作 / 浏览场景，应当能被群友看到的应用。
 */
export const DEFAULT_ALLOW_APPS = [
    // browsers
    'chrome',
    'edge',
    'firefox',
    'safari',
    'opera',
    'brave',
    'vivaldi',
    'arc',
    // IDE / editors
    'code', // VS Code
    'cursor',
    'visual studio',
    'devenv',
    'idea',
    'webstorm',
    'pycharm',
    'goland',
    'rider',
    'clion',
    'rustrover',
    'phpstorm',
    'datagrip',
    'fleet',
    'sublime',
    'atom',
    'notepad',
    'typora',
    'obsidian',
    'notion',
    'logseq',
    // shells / terminals
    'windowsterminal',
    'powershell',
    'pwsh',
    'cmd',
    'conhost',
    'wezterm',
    'iterm',
    'alacritty',
    'kitty',
    'tabby',
    'hyper',
    // file managers
    'explorer',
    'finder',
    // common IM / collab
    'wechat',
    'weixin',
    'qq',
    'tim',
    'telegram',
    'discord',
    'slack',
    'teams',
    'zoom',
    'feishu',
    'lark',
    'dingtalk',
    // office
    'word',
    'excel',
    'powerpoint',
    'wps',
    'acrobat',
    'sumatra'
]

export interface FullscreenDetectorOptions {
    enabled: boolean
    /** 不算 busy 的应用名（不区分大小写、子串匹配）。 */
    allowApps?: string[]
    /** 强制视为 busy 的应用名（不区分大小写、子串匹配）。优先级高于 allowApps。 */
    busyApps?: string[]
}

export interface FullscreenCheckResult {
    busy: boolean
    /** 命中的判定原因，方便排查 */
    reason?: 'allow_app' | 'busy_app' | 'fullscreen_geometry'
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
    private allowApps: string[]
    private busyApps: string[]

    constructor(private options: FullscreenDetectorOptions) {
        this.allowApps = (options.allowApps ?? DEFAULT_ALLOW_APPS).map((s) =>
            s.toLowerCase()
        )
        this.busyApps = (options.busyApps ?? []).map((s) => s.toLowerCase())
    }

    setEnabled(enabled: boolean) {
        this.options.enabled = enabled
    }

    isEnabled() {
        return this.options.enabled
    }

    /**
     * 获取当前活动窗口。无法获取时返回 undefined。
     */
    async getActiveWindow(): Promise<ActiveWindowInfo | undefined> {
        if (!this.options.enabled) return undefined
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
                bounds: win.bounds,
                contentBounds: win.contentBounds
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.debug(`activeWindow failed: ${message}`)
            return undefined
        }
    }

    /**
     * 综合判定当前窗口是否应当视为 busy。
     *
     * 优先级：
     *  1. allowApps 命中 → 永不 busy（即使 F11 全屏 chrome）
     *  2. busyApps 命中 → 永远 busy
     *  3. 几何全屏：bounds 起点贴近 (0,0) AND `contentBounds == bounds`
     *     AND 覆盖整块显示器 → busy
     */
    check(
        win: ActiveWindowInfo,
        display: { width?: number; height?: number }
    ): FullscreenCheckResult {
        const app = win.app.toLowerCase()
        const title = win.title.toLowerCase()

        // busyApps 优先级最高（用户显式标注的"独占"应用）
        if (this.matchAny(this.busyApps, app, title)) {
            return { busy: true, reason: 'busy_app' }
        }

        // allowApps 拦掉所有正常应用，无论几何上是不是 fullscreen
        if (this.matchAny(this.allowApps, app, title)) {
            return { busy: false, reason: 'allow_app' }
        }

        if (this.isFullscreenGeometry(win, display)) {
            return { busy: true, reason: 'fullscreen_geometry' }
        }

        return { busy: false }
    }

    private matchAny(patterns: string[], ...haystack: string[]) {
        if (patterns.length === 0) return false
        return patterns.some((p) => haystack.some((h) => h.includes(p)))
    }

    /**
     * 几何上是否是真正的全屏（区别于"最大化窗口"）。
     *
     * 关键观察（Windows 上）：
     *  - 最大化的普通窗口：`bounds.x = -7, bounds.y = -7`（aero 边框 overscan），
     *    `contentBounds` 比 `bounds` 小一圈（标题栏 / 边框被排除）
     *  - 真正的全屏（F11 / 全屏游戏）：`bounds.x = 0, bounds.y = 0`，
     *    `contentBounds == bounds`，整体尺寸贴合整块显示器
     *
     * macOS / Linux 通常没有 contentBounds，退化为只看起点和尺寸。
     */
    private isFullscreenGeometry(
        win: ActiveWindowInfo,
        display: { width?: number; height?: number }
    ) {
        if (!display.width || !display.height) return false
        const { bounds, contentBounds } = win
        if (bounds.width <= 0 || bounds.height <= 0) return false

        // 起点必须紧贴显示器原点
        if (Math.abs(bounds.x) > 1 || Math.abs(bounds.y) > 1) return false

        // 有 contentBounds 时（Windows）：必须与 bounds 完全相等
        // —— 这是区分"最大化"和"真全屏"的关键。
        if (contentBounds) {
            const sameOrigin =
                contentBounds.x === bounds.x && contentBounds.y === bounds.y
            const sameSize =
                contentBounds.width === bounds.width &&
                contentBounds.height === bounds.height
            if (!sameOrigin || !sameSize) return false
        }

        // 几何尺寸覆盖整块显示器（DPI 缩放后两个维度比例一致）。
        const widthRatio = bounds.width / display.width
        const heightRatio = bounds.height / display.height
        const ratioMismatch =
            Math.abs(widthRatio - heightRatio) /
            Math.max(widthRatio, heightRatio)
        if (ratioMismatch > 0.02) return false

        // 比例落在常见 DPI 缩放对应的覆盖率上：100/125/150/175/200/225/250%
        const scale = (widthRatio + heightRatio) / 2
        const dpiScales = [1.0, 0.8, 2 / 3, 4 / 7, 0.5, 4 / 9, 0.4]
        return dpiScales.some((s) => Math.abs(scale - s) < 0.01)
    }

    /** 兼容旧名字。新代码用 `check`。 */
    isFullscreen(
        win: ActiveWindowInfo,
        display: { width?: number; height?: number }
    ) {
        return this.check(win, display).busy
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
