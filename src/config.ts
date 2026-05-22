import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import yargsParser from 'yargs-parser'

export interface ResolvedConfig {
    server: string
    token: string
    name: string
    display?: number | string
    format: 'png' | 'jpg'
    reconnect: boolean
    backoff: number
    color: boolean
    detectFullscreen: boolean
}

export interface CliFlags {
    help?: boolean
    version?: boolean
    listDisplays?: boolean
    config?: ResolvedConfig
}

const HELP_TEXT = `argus-eye [options]

  -s, --server <url>       WebSocket 地址（必填，如 ws://host:5140/argus）
  -t, --token  <token>     鉴权 token（必填）
  -n, --name   <name>      上报给服务端的名字（默认: os.hostname()）
  -d, --display <id>       默认截哪块屏（数字 id，缺省=主屏）
      --list-displays      列出本机显示器后退出
      --format <png|jpg>   传输格式（默认 jpg，省流量）
      --no-reconnect       禁用断线重连
      --backoff <ms>       重连最大间隔（默认 30000）
      --no-detect-fullscreen
                           关闭"全屏即拒拍"行为（默认开启）。打开时若检测到
                           当前焦点窗口铺满整块显示器（如全屏游戏 / 视频），
                           则向服务端返回 peek_busy 而不是真截图。
      --config <path>      JSON 配置文件
      --no-color           关闭着色输出
  -h, --help               显示帮助
  -v, --version            显示版本

环境变量：ARGUS_SERVER / ARGUS_TOKEN / ARGUS_NAME 也会被读取，
优先级：argv > env > ~/.argus-eye.json (或 --config 指定) > 默认值。
`

export function parseArgs(argv: string[]): CliFlags {
    const parsed = yargsParser(argv, {
        alias: {
            server: ['s'],
            token: ['t'],
            name: ['n'],
            display: ['d'],
            help: ['h'],
            version: ['v']
        },
        string: ['server', 'token', 'name', 'config', 'format', 'display'],
        number: ['backoff'],
        boolean: [
            'help',
            'version',
            'reconnect',
            'color',
            'listDisplays',
            'detectFullscreen'
        ],
        configuration: {
            'camel-case-expansion': true,
            'strip-aliased': true,
            'unknown-options-as-args': false
        },
        default: {
            reconnect: true,
            color: true,
            listDisplays: false,
            detectFullscreen: true
        }
    })

    if (parsed.help) return { help: true }
    if (parsed.version) return { version: true }

    const fileConfig = loadConfigFile(
        typeof parsed.config === 'string' ? parsed.config : undefined
    )

    const env = process.env
    const merged: Partial<ResolvedConfig> = {
        server:
            asString(parsed.server) ??
            env.ARGUS_SERVER ??
            asString(fileConfig.server),
        token:
            asString(parsed.token) ??
            env.ARGUS_TOKEN ??
            asString(fileConfig.token),
        name:
            asString(parsed.name) ??
            env.ARGUS_NAME ??
            asString(fileConfig.name) ??
            os.hostname(),
        display:
            asDisplay(parsed.display) ??
            asDisplay(fileConfig.display) ??
            undefined,
        format:
            (asString(parsed.format) as 'png' | 'jpg') ??
            (asString(fileConfig.format) as 'png' | 'jpg') ??
            'jpg',
        reconnect:
            asBoolean(parsed.reconnect) ??
            asBoolean(fileConfig.reconnect) ??
            true,
        backoff:
            asNumber(parsed.backoff) ?? asNumber(fileConfig.backoff) ?? 30_000,
        color: asBoolean(parsed.color) ?? true,
        detectFullscreen:
            asBoolean(parsed.detectFullscreen) ??
            asBoolean(fileConfig.detectFullscreen) ??
            true
    }

    if (parsed.listDisplays) {
        return {
            listDisplays: true,
            config: {
                server: merged.server ?? '',
                token: merged.token ?? '',
                name: merged.name ?? os.hostname(),
                display: merged.display,
                format: (merged.format as 'png' | 'jpg') ?? 'jpg',
                reconnect: merged.reconnect ?? true,
                backoff: merged.backoff ?? 30_000,
                color: merged.color ?? true,
                detectFullscreen: merged.detectFullscreen ?? true
            }
        }
    }

    if (!merged.server) {
        throw new Error('missing --server (or ARGUS_SERVER)')
    }
    if (!merged.token) {
        throw new Error('missing --token (or ARGUS_TOKEN)')
    }
    if (merged.format !== 'png' && merged.format !== 'jpg') {
        throw new Error(`invalid --format: ${merged.format}`)
    }

    return {
        config: {
            server: merged.server,
            token: merged.token,
            name: merged.name ?? os.hostname(),
            display: merged.display,
            format: merged.format,
            reconnect: merged.reconnect ?? true,
            backoff: merged.backoff ?? 30_000,
            color: merged.color ?? true,
            detectFullscreen: merged.detectFullscreen ?? true
        }
    }
}

export function getHelpText() {
    return HELP_TEXT
}

function loadConfigFile(explicit?: string): Record<string, unknown> {
    const candidates = [
        explicit,
        path.join(os.homedir(), '.argus-eye.json'),
        path.join(os.homedir(), '.config', 'argus-eye', 'config.json')
    ].filter((p): p is string => Boolean(p))

    for (const file of candidates) {
        try {
            if (fs.existsSync(file)) {
                const raw = fs.readFileSync(file, 'utf-8')
                return JSON.parse(raw)
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.warn(`failed to read config ${file}: ${message}`)
        }
    }
    return {}
}

function asString(v: unknown): string | undefined {
    if (typeof v === 'string' && v.length > 0) return v
    return undefined
}

function asNumber(v: unknown): number | undefined {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.length > 0 && !Number.isNaN(Number(v))) {
        return Number(v)
    }
    return undefined
}

function asBoolean(v: unknown): boolean | undefined {
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') {
        if (v === 'true') return true
        if (v === 'false') return false
    }
    return undefined
}

/** display 在 windows 上是 \\.\DISPLAY1 这种字符串，linux/macOS 上是数字。 */
function asDisplay(v: unknown): number | string | undefined {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.length > 0) {
        const n = Number(v)
        if (!Number.isNaN(n) && /^-?\d+$/.test(v)) return n
        return v
    }
    return undefined
}
