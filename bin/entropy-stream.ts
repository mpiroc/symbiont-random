import * as readline from 'readline'
import * as stream from 'stream'

const BITS_PER_BYTE: number = 8

export class EntropyStream extends stream.Readable {
    private _entropy: boolean[] = []
    private _isReading: boolean = false

    public constructor(input: NodeJS.ReadStream) {
        super()

        readline.emitKeypressEvents(input)
        if (input.isTTY) {
            input.setRawMode(true)
        }

        input.on('keypress', (_character, _keypress) => {
            if (_keypress.sequence === "\u0003") {
                // According to https://nodejs.org/api/tty.html#tty_readstream_setrawmode_mode,
                // streams do not trigger a SIGINT on ctrl+c when in raw mode. So we (roughly)
                // approximate it by exiting the process.
                process.exit()
            }

            // NOTE: This is insecure--the timestamp isn't the true time that the key was pressed, but the
            // time that this event handler runs, which is (potentially?) predictable by an attacker. We
            // can't access the drivers directly like the OS can, so this isn't a perfect port of /dev/random.
            const timestamp = process.hrtime.bigint() / 100n
            this._entropy.push(timestamp % 2n === 0n)

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
            const bits = this._entropy.slice(0, BITS_PER_BYTE)
            this._entropy = this._entropy.slice(BITS_PER_BYTE)

            // TODO: Verify this assumption
            // Assumption: Since the bits are already random, we don't need
            // to use them to seed a PRNG--we can just use them directly.
            let byte: number = 0
            for (const bit of bits) {
                byte = byte << 1 | (bit ? 1 : 0)
            }

            // `cat` uses utf8 by default, so let's interpret the random bytes
            // as utf8 for consistency with `cat /dev/random`.
            if (!this.push(Buffer.from([ byte ]), 'utf8')) {
                this._isReading = false
                return
            }
        }
    }
}