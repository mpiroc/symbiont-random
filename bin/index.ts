import { EntropyStream } from './entropy-stream'

const stream = new EntropyStream(process.stdin)
stream.pipe(process.stdout)
