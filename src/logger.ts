import kleur from 'kleur'

let colorEnabled = true

export function setColorEnabled(value: boolean) {
    colorEnabled = value
    kleur.enabled = value
}

function ts() {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function tag(label: string, color: (s: string) => string) {
    const t = `[${ts()}]`
    if (!colorEnabled) return `${t} ${label}`
    return `${kleur.gray(t)} ${color(label)}`
}

export const logger = {
    info(...args: unknown[]) {
        console.log(tag('info ', kleur.cyan), ...args)
    },
    success(...args: unknown[]) {
        console.log(tag('ok   ', kleur.green), ...args)
    },
    warn(...args: unknown[]) {
        console.warn(tag('warn ', kleur.yellow), ...args)
    },
    error(...args: unknown[]) {
        console.error(tag('error', kleur.red), ...args)
    },
    debug(...args: unknown[]) {
        if (!process.env.ARGUS_DEBUG) return
        console.log(tag('debug', kleur.magenta), ...args)
    }
}
