import * as readline from 'readline'
import * as stream from 'stream'

const MAX_STORED_BITS_OF_ENTROPY: number = 1024
const BITS_PER_BYTE: number = 8

export class EntropyStream extends stream.Readable {
    // It would be more memory-efficient to use a Uint8Array, rather than a separate boolean
    // for each bit. But the implementation is a bit simpler this way, and we can optimize later
    // if necessary.
    private _entropy: boolean[] = []
    private _isReading: boolean = false

    public constructor(input: NodeJS.ReadStream) {
        super()

        readline.emitKeypressEvents(input)
        if (input.isTTY) {
            input.setRawMode(true)
        }

        input.on('keypress', (_character, keypress) => {
            if (keypress.sequence === "\u0003") {
                // According to https://nodejs.org/api/tty.html#tty_readstream_setrawmode_mode,
                // streams do not trigger a SIGINT on ctrl+c when in raw mode. So we (roughly)
                // approximate it by exiting the process.
                process.exit()
            }

            // Prevent memory leak in the case that the stream is never consumed.
            if (this._entropy.length >= MAX_STORED_BITS_OF_ENTROPY) {
                return
            }

            // NOTE 1: This is insecure--the timestamp isn't the true time that the key was pressed, but the
            //         time that this event handler runs, which is (potentially?) predictable by an attacker.
            //         We can't access the drivers directly like the OS can, so this isn't a perfect port of
            //         cat /dev/random.
            // NOTE 2: By observation, the last two (decimal) digits of process.hrtime.bigint() are always "09".
            //         So we truncate and use the third-last bit instead.
            const timestamp = process.hrtime.bigint() / 100n

            // Array.unshift is like Array.push, but adds elements to the beginning of the array rather than
            // the end. This lets us treat the array like a queue.
            this._entropy.unshift(timestamp % 2n === 0n)

            if (this._isReading) {
                this.flushBits()
            }
        })
    }

    // According to https://nodejs.org/api/stream.html#stream_readable_read_size_1,
    // the _size parameter is advisory only and may be safely ignored.
    public _read(_size: number): void {
        // After `_read` is called, it will not be called again until `push` is called.
        // Therefore, if no data is available to be pushed when `_read` is first called,
        // we must continue listening and push data as it becomes available.
        // See https://nodejs.org/api/stream.html#stream_readable_read_size_1
        this._isReading = true
        this.flushBits()
    }

    private flushBits(): void {
        while (this._entropy.length >= BITS_PER_BYTE) {
            const bits: boolean[] = []
            for (let i = 0; i < BITS_PER_BYTE; i++) {
                bits.push(this._entropy.pop()!)
            
            }
            // TODO: Verify this assumption
            // Assumption: Since the bits are already random, we don't need
            // to use them to seed a PRNG--we can just use them directly.
            let byte: number = 0
            for (const bit of bits) {
                byte = byte << 1 | (bit ? 1 : 0)
            }

            // As far as I can tell, /dev/random emits a stream of raw bytes, which
            // is then interpreted by `cat` as utf8. So let's do the same here.
            if (!this.push(Buffer.from([ byte ]), 'utf8')) {
                this._isReading = false
                return
            }
        }
    }
}