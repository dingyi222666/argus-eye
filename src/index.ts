import { createRequire } from 'node:module'
import { ArgusClient } from './client'
import { listDisplays } from './capture'
import { getHelpText, parseArgs } from './config'
import { logger, setColorEnabled } from './logger'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json') as { version: string }

export async function start() {
    let parsed
    try {
        parsed = parseArgs(process.argv.slice(2))
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        process.stderr.write(`argus-eye: ${message}\n\n`)
        process.stderr.write(getHelpText())
        process.exit(2)
    }

    if (parsed.help) {
        process.stdout.write(getHelpText())
        return
    }

    if (parsed.version) {
        process.stdout.write(`argus-eye v${pkg.version}\n`)
        return
    }

    if (parsed.config && !parsed.config.color) {
        setColorEnabled(false)
    } else {
        setColorEnabled(true)
    }

    if (parsed.listDisplays) {
        try {
            const displays = await listDisplays()
            if (displays.length === 0) {
                process.stdout.write('no displays found\n')
                return
            }
            // 按 ArgusClient 上线时报告给服务端的索引(0..N-1)展示，
            // 这样和群里 /peek -d <id> 用的索引保持一致。
            displays.forEach((d, i) => {
                const size =
                    d.width && d.height ? `${d.width}x${d.height}` : 'unknown'
                process.stdout.write(
                    `${i}\t${d.name ?? '-'}\t${size}${
                        d.primary ? '\t(primary)' : ''
                    }\t[native:${d.id}]\n`
                )
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            process.stderr.write(`failed to list displays: ${message}\n`)
            process.exit(1)
        }
        return
    }

    const config = parsed.config!
    const client = new ArgusClient(config, pkg.version)

    const handleSignal = (signal: string) => {
        logger.info(`received ${signal}, shutting down ...`)
        client.stop()
        // 给 socket 一点时间关掉
        setTimeout(() => process.exit(0), 200)
    }

    process.on('SIGINT', () => handleSignal('SIGINT'))
    process.on('SIGTERM', () => handleSignal('SIGTERM'))

    await client.start()
}
