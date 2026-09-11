import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireFaceCameraStream } from './adaptiveCameraCapture'

function makeTrack() {
    return { stop: vi.fn() }
}

function makeStream() {
    const track = makeTrack()
    return {
        stream: { getTracks: () => [track] } as unknown as MediaStream,
        track,
    }
}

function makeVideo() {
    const video = document.createElement('video')
    // jsdom no implementa play()/videoWidth de verdad -- se controla a mano
    // en cada test.
    ;(video as any).play = vi.fn().mockResolvedValue(undefined)
    return video
}

describe('acquireFaceCameraStream', () => {
    let getUserMedia: ReturnType<typeof vi.fn>

    beforeEach(() => {
        getUserMedia = vi.fn()
        Object.defineProperty(global.navigator, 'mediaDevices', {
            value: { getUserMedia },
            configurable: true,
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('acepta el primer escalón si realmente entrega un frame (rVFC)', async () => {
        const { stream, track } = makeStream()
        getUserMedia.mockResolvedValueOnce(stream)
        const video = makeVideo()
        ;(video as any).requestVideoFrameCallback = (cb: () => void) => {
            cb()
            return 1
        }

        const result = await acquireFaceCameraStream(video, () => false)

        expect(result).toBe(stream)
        expect(getUserMedia).toHaveBeenCalledTimes(1)
        expect(track.stop).not.toHaveBeenCalled()
    })

    it('baja de escalón cuando uno concede permiso pero nunca entrega un frame real', async () => {
        const badStream = makeStream()
        const goodStream = makeStream()
        getUserMedia
            .mockResolvedValueOnce(badStream.stream) // 1920x1440: "resuelve" pero sin frame
            .mockResolvedValueOnce(goodStream.stream) // 1280x960: sí entrega frame

        let call = 0
        const video = makeVideo()
        ;(video as any).requestVideoFrameCallback = (cb: () => void) => {
            call += 1
            // Solo el segundo escalón (segunda llamada a getUserMedia) llega
            // a entregar un frame real dentro del timeout.
            if (call >= 2) cb()
            return call
        }

        const result = await acquireFaceCameraStream(video, () => false)

        expect(result).toBe(goodStream.stream)
        expect(getUserMedia).toHaveBeenCalledTimes(2)
        expect(badStream.track.stop).toHaveBeenCalled()
        expect(goodStream.track.stop).not.toHaveBeenCalled()
    }, 10000)

    it('no reintenta en escalones más bajos tras un permiso denegado (NotAllowedError)', async () => {
        getUserMedia.mockRejectedValueOnce(
            new DOMException('denied', 'NotAllowedError')
        )
        const video = makeVideo()

        await expect(acquireFaceCameraStream(video, () => false)).rejects.toMatchObject({
            name: 'NotAllowedError',
        })
        expect(getUserMedia).toHaveBeenCalledTimes(1)
    })

    it('cae al fallback final sin restricción de resolución si toda la escalera falla', async () => {
        const finalStream = makeStream()
        getUserMedia
            .mockRejectedValueOnce(new DOMException('no', 'OverconstrainedError'))
            .mockRejectedValueOnce(new DOMException('no', 'OverconstrainedError'))
            .mockRejectedValueOnce(new DOMException('no', 'OverconstrainedError'))
            .mockRejectedValueOnce(new DOMException('no', 'OverconstrainedError'))
            .mockResolvedValueOnce(finalStream.stream)

        const video = makeVideo()
        ;(video as any).requestVideoFrameCallback = (cb: () => void) => {
            cb()
            return 1
        }

        const result = await acquireFaceCameraStream(video, () => false)

        expect(result).toBe(finalStream.stream)
        expect(getUserMedia).toHaveBeenCalledTimes(5)
    })

    it('lanza NotReadableError si ni siquiera el fallback final entrega un frame real', async () => {
        const streams = Array.from({ length: 5 }, () => makeStream())
        streams.forEach(({ stream }) => getUserMedia.mockResolvedValueOnce(stream))

        const video = makeVideo()
        ;(video as any).requestVideoFrameCallback = (_cb: () => void) => {
            // Nunca llama a cb(): ningún escalón entrega frame real.
            return 1
        }

        await expect(acquireFaceCameraStream(video, () => false)).rejects.toMatchObject({
            name: 'NotReadableError',
        })
        expect(getUserMedia).toHaveBeenCalledTimes(5)
        streams.forEach(({ track }) => expect(track.stop).toHaveBeenCalled())
    }, 15000)

    it('aborta sin seguir negociando cuando isCancelled ya es true', async () => {
        const video = makeVideo()

        await expect(acquireFaceCameraStream(video, () => true)).rejects.toMatchObject({
            name: 'AbortError',
        })
        expect(getUserMedia).not.toHaveBeenCalled()
    })
})
