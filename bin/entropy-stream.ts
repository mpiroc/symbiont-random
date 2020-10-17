import * as readline from 'readline'
import * as stream from 'stream'

const BITS_PER_BYTE: number = 8

export class EntropyStream extends stream.Readable {
    // TODO: Use a Queue instead.
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

            // NOTE: This is insecure--the timestamp isn't the true time that the key was pressed, but the
            // time that this event handler runs, which is (potentially?) predictable by an attacker. We
            // can't access the drivers directly like the OS can, so this isn't a perfect port of /dev/random.
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