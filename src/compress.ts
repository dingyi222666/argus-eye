import {
    PhotonImage,
    resize,
    SamplingFilter
} from '@cf-wasm/photon/node'

export interface CompressOptions {
    /** 目标体积上限（字节）。 */
    targetBytes: number
    /** 起始 jpeg 质量。 */
    initialQuality?: number
    /** 最低 jpeg 质量。 */
    minQuality?: number
}

/**
 * 把图片压到 `targetBytes` 以内的 JPEG。
 *
 * 性能优先（photon WASM 实现）：
 *  - 输入已经 ≤ target → 直接返回（0 ms）。
 *  - 否则估算 quality 编一遍。命中就完事；不行再 resize 一次。
 *  - photon 的 resize 偏慢（~180ms / 2560x1440），所以放在最后兜底。
 *
 * 典型路径 ≤ 200ms：decode (~65ms) + 1 次 encode (~110ms) = ~175ms。
 */
export function compressToBudget(
    input: Buffer,
    options: CompressOptions
): Buffer {
    const target = Math.max(8 * 1024, options.targetBytes)
    if (input.length <= target) return input

    const initialQuality = options.initialQuality ?? 80
    const minQuality = options.minQuality ?? 40

    const img = PhotonImage.new_from_byteslice(new Uint8Array(input))
    try {
        // 先用估算的 quality 直接编一发，多数情况一次就到目标了。
        // 经验：jpeg 体积 ~ quality^1.5 量级，所以用 1.0 比例做首次估算就好。
        const ratioByteWise = target / input.length
        const estQ = Math.max(
            minQuality,
            Math.min(initialQuality, Math.round(initialQuality * ratioByteWise))
        )
        let buf = Buffer.from(img.get_bytes_jpeg(estQ))
        if (buf.length <= target) return buf

        // 不够：基于实际结果再降 quality 一次。
        const q2 = Math.max(
            minQuality,
            Math.round(estQ * (target / buf.length) * 0.95)
        )
        if (q2 < estQ) {
            buf = Buffer.from(img.get_bytes_jpeg(q2))
            if (buf.length <= target) return buf
        }

        // 还不够：缩一档再编。
        const w = img.get_width()
        const h = img.get_height()
        const scale = Math.sqrt(target / buf.length) * 0.9
        const newW = Math.max(64, Math.round(w * scale))
        const newH = Math.max(64, Math.round(h * scale))
        const small = resize(img, newW, newH, SamplingFilter.Triangle)
        try {
            // resize 后估的 quality：维持上一轮的 q2 即可
            return Buffer.from(small.get_bytes_jpeg(q2))
        } finally {
            small.free()
        }
    } finally {
        img.free()
    }
}
