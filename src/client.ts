import WebSocket from 'ws'
import type { ResolvedConfig } from './config'
import { logger } from './logger'
import { capture, listDisplays } from './capture'
import { FullscreenDetector } from './fullscreen'
import type {
    ClientFrame,
    DisplayInfo,
    HelloAckFrame,
    PeekRequestFrame,
    ServerFrame
} from './protocol'

const HEARTBEAT_TIMEOUT_MS = 90_000 // 服务端 30s 一次 ping，3 次没动静就当断了

export interface ClientHooks {
    onConnected?: (info: { displays: DisplayInfo[] }) => void
    onDisconnected?: (reason: string) => void
}

export class ArgusClient {
    private socket?: WebSocket
    private displays: DisplayInfo[] = []
    /** 服务端看到的 display 索引(0..N-1) → 本机原生 id 的映射。 */
    private nativeIds: (number | string)[] = []
    private stopped = false
    private reconnectAttempts = 0
    private reconnectTimer?: NodeJS.Timeout
    private heartbeatTimer?: NodeJS.Timeout
    private lastSeen = 0
    /** 是否已成功握手（hello_ack ok）。close 时根据这个判断是不是“瞬关”。 */
    private handshaken = false
    private openedAt = 0
    private fullscreen: FullscreenDetector

    constructor(
        private readonly config: ResolvedConfig,
        private readonly version: string,
        private readonly hooks: ClientHooks = {}
    ) {
        this.fullscreen = new FullscreenDetector(config.detectFullscreen)
    }

    async start() {
        try {
            const native = await listDisplays()
            this.nativeIds = native.map((d) => d.id)
            // 对外重新索引为 0..N-1，避免 windows 上的 \\.\DISPLAY1 这种字符串。
            this.displays = native.map((d, i) => ({
                id: i,
                name: d.name ?? String(d.id),
                width: d.width,
                height: d.height,
                primary: d.primary
            }))
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.warn(`failed to list displays: ${message}`)
            this.displays = []
            this.nativeIds = []
        }
        this.connect()
    }

    stop() {
        this.stopped = true
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.clearHeartbeat()
        if (this.socket) {
            try {
                this.send({ type: 'bye', reason: 'cli_exit' })
            } catch {
                /* ignore */
            }
            try {
                this.socket.close(1000, 'cli_exit')
            } catch {
                /* ignore */
            }
        }
    }

    private connect() {
        if (this.stopped) return
        logger.info(`connecting to ${this.config.server} ...`)

        let socket: WebSocket
        try {
            socket = new WebSocket(this.config.server)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.error(`failed to create socket: ${message}`)
            this.scheduleReconnect()
            return
        }

        this.socket = socket
        this.handshaken = false
        this.openedAt = 0

        socket.on('open', () => {
            // 不在这里清零重连计数，等 hello_ack 成功再清。
            this.openedAt = Date.now()
            this.lastSeen = Date.now()
            const defaultIndex = this.resolveDefaultIndex()
            this.send({
                type: 'hello',
                name: this.config.name,
                token: this.config.token,
                version: this.version,
                displays: this.displays,
                defaultDisplay: defaultIndex
            })
        })

        socket.on('message', (raw, isBinary) => {
            if (isBinary) return
            this.lastSeen = Date.now()
            const text =
                typeof raw === 'string' ? raw : raw.toString('utf8')
            let frame: ServerFrame
            try {
                frame = JSON.parse(text) as ServerFrame
            } catch {
                return
            }
            this.handleFrame(frame)
        })

        socket.on('close', (code, reasonBuf) => {
            const reason = reasonBuf?.toString() || `code_${code}`
            this.clearHeartbeat()
            this.socket = undefined
            this.hooks.onDisconnected?.(reason)
            if (code === 4001) {
                logger.error('auth failed: token rejected by server. exiting.')
                process.exit(2)
            }
            if (code === 4004) {
                logger.error(
                    `auth failed: server rejected name "${this.config.name}". exiting.`
                )
                process.exit(2)
            }
            // 检测“连上即关” —— 多半是 WS 路径不对（koishi server 找不到匹配的
            // ws 处理器就直接 socket.close()，对端看到的就是 1005/1006）。
            const justOpenedAndClosed =
                this.openedAt > 0 &&
                !this.handshaken &&
                Date.now() - this.openedAt < 3000
            if (justOpenedAndClosed && (code === 1005 || code === 1006)) {
                logger.warn(
                    `disconnected immediately after open (${code} ${reason}). ` +
                        `check the WebSocket path: server is configured at ` +
                        `${this.config.server} ?`
                )
            } else {
                logger.warn(`disconnected (${code} ${reason})`)
            }
            this.scheduleReconnect()
        })

        socket.on('error', (err) => {
            logger.warn(`socket error: ${err.message}`)
        })
    }

    private handleFrame(frame: ServerFrame) {
        switch (frame.type) {
            case 'hello_ack':
                return this.onHelloAck(frame)
            case 'peek':
                return void this.onPeek(frame)
            case 'ping':
                this.send({ type: 'pong', t: frame.t })
                return
            case 'pong':
                return
        }
    }

    private onHelloAck(frame: HelloAckFrame) {
        if (!frame.ok) {
            logger.error(`server rejected hello: ${frame.error ?? 'unknown'}`)
            // close 事件里会按 code 判断是否退出
            return
        }
        this.handshaken = true
        this.reconnectAttempts = 0
        logger.success(
            `connected as "${this.config.name}"; ${this.displays.length} display(s) reported`
        )
        for (const d of this.displays) {
            const size =
                d.width && d.height ? `${d.width}x${d.height}` : 'unknown'
            logger.info(`  · display ${d.id}: ${d.name ?? '-'} (${size})`)
        }
        logger.info(
            `fullscreen detection: ${this.fullscreen.isEnabled() ? 'on' : 'off'}`
        )
        this.startHeartbeat()
        this.hooks.onConnected?.({ displays: this.displays })
    }

    private async onPeek(frame: PeekRequestFrame) {
        // frame.display 是公开索引（0..N-1）。映射到本机原生 id 再传给 screenshot-desktop。
        let publicIndex: number | undefined
        let target: number | string | undefined
        if (frame.display !== undefined) {
            const idx = typeof frame.display === 'number'
                ? frame.display
                : Number(frame.display)
            if (Number.isFinite(idx) && this.nativeIds[idx] !== undefined) {
                publicIndex = idx
                target = this.nativeIds[idx]
            } else {
                this.send({
                    type: 'peek_error',
                    id: frame.id,
                    error: `unknown_display:${frame.display}`
                })
                return
            }
        } else {
            publicIndex = this.resolveDefaultIndex()
            target =
                publicIndex !== undefined
                    ? this.nativeIds[publicIndex]
                    : undefined
        }

        // 先做一遍全屏检测：在玩游戏 / 全屏视频时不出图，让服务端走 busy 分支。
        if (this.fullscreen.isEnabled()) {
            const win = await this.fullscreen.getActiveWindow()
            const display =
                publicIndex !== undefined
                    ? this.displays[publicIndex]
                    : undefined
            if (
                win &&
                display &&
                this.fullscreen.isFullscreen(win, display)
            ) {
                logger.info(
                    `peek #${frame.id} → busy: ${win.app || win.title || 'fullscreen'}`
                )
                this.send({
                    type: 'peek_busy',
                    id: frame.id,
                    app: win.app,
                    title: win.title,
                    reason: 'fullscreen'
                })
                return
            }
        }

        const start = Date.now()
        try {
            const result = await capture({
                display: target,
                format: this.config.format
            })
            const base64 = result.buffer.toString('base64')
            this.send({
                type: 'peek_result',
                id: frame.id,
                image: base64,
                mime: result.mime,
                display: frame.display
            })
            const elapsed = Date.now() - start
            const kb = (result.buffer.length / 1024).toFixed(1)
            logger.info(
                `peek #${frame.id} → display ${
                    frame.display ?? 'default'
                } (${kb} KB ${this.config.format}, ${elapsed}ms)`
            )
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.warn(`peek #${frame.id} failed: ${message}`)
            this.send({
                type: 'peek_error',
                id: frame.id,
                error: message
            })
        }
    }

    /**
     * 解析 cli 配置里 `--display` 在 displays 列表中对应的索引。
     * 支持数字索引 / 名字（不区分大小写） / 原生 id。
     */
    private resolveDefaultIndex(): number | undefined {
        const target = this.config.display
        if (target === undefined) {
            const primary = this.displays.findIndex((d) => d.primary)
            if (primary >= 0) return primary
            return this.displays.length > 0 ? 0 : undefined
        }
        if (typeof target === 'number' && this.displays[target]) return target
        const lower = String(target).toLowerCase()
        for (let i = 0; i < this.displays.length; i++) {
            const d = this.displays[i]
            const nativeId = this.nativeIds[i]
            if (
                String(d.id) === String(target) ||
                String(nativeId).toLowerCase() === lower ||
                (d.name && d.name.toLowerCase() === lower)
            ) {
                return i
            }
        }
        return this.displays.length > 0 ? 0 : undefined
    }

    private startHeartbeat() {
        this.clearHeartbeat()
        this.heartbeatTimer = setInterval(() => {
            const elapsed = Date.now() - this.lastSeen
            if (elapsed > HEARTBEAT_TIMEOUT_MS) {
                logger.warn('heartbeat timeout, closing socket')
                try {
                    this.socket?.terminate()
                } catch {
                    /* ignore */
                }
            }
        }, 15_000)
    }

    private clearHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = undefined
        }
    }

    private scheduleReconnect() {
        if (this.stopped) return
        if (!this.config.reconnect) {
            logger.info('reconnect disabled, exiting.')
            process.exit(1)
        }
        this.reconnectAttempts++
        const base = 1000
        const exp = Math.min(this.reconnectAttempts - 1, 16)
        const delay = Math.min(this.config.backoff, base * Math.pow(2, exp))
        const jitter = Math.floor(Math.random() * 500)
        const wait = delay + jitter
        logger.info(
            `reconnecting in ${wait}ms (attempt #${this.reconnectAttempts}) ...`
        )
        this.reconnectTimer = setTimeout(() => this.connect(), wait)
    }

    private send(frame: ClientFrame) {
        const socket = this.socket
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify(frame))
    }
}
