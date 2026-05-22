// 与 koishi-plugin-argus 共享的 WebSocket 协议（客户端侧子集）。

export interface DisplayInfo {
    id: number | string
    name?: string
    width?: number
    height?: number
    primary?: boolean
}

export interface HelloFrame {
    type: 'hello'
    name: string
    token: string
    version?: string
    displays?: DisplayInfo[]
    defaultDisplay?: number
}

export interface HelloAckFrame {
    type: 'hello_ack'
    ok: boolean
    error?: string
}

export interface PeekRequestFrame {
    type: 'peek'
    id: string
    display?: number | string
}

export interface PeekResultFrame {
    type: 'peek_result'
    id: string
    image: string
    mime?: string
    width?: number
    height?: number
    display?: number | string
}

export interface PeekErrorFrame {
    type: 'peek_error'
    id: string
    error: string
}

export interface PeekBusyFrame {
    type: 'peek_busy'
    id: string
    app?: string
    title?: string
    reason?: 'fullscreen' | string
}

export interface PingFrame {
    type: 'ping'
    t?: number
}

export interface PongFrame {
    type: 'pong'
    t?: number
}

export interface ByeFrame {
    type: 'bye'
    reason?: string
}

export type ServerFrame =
    | HelloAckFrame
    | PeekRequestFrame
    | PingFrame
    | PongFrame

export type ClientFrame =
    | HelloFrame
    | PeekResultFrame
    | PeekErrorFrame
    | PeekBusyFrame
    | PingFrame
    | PongFrame
    | ByeFrame
