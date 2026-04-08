import path from 'node:path'

import ParallelLauncher from './launcher.js'

function getConfigPath(argv: string[]) {
    if (argv[0] === 'run' && argv[1]) {
        return argv[1]
    }

    return argv[0]
}

export default async function run() {
    const argv = process.argv.slice(2)
    const configPath = getConfigPath(argv)

    if (!configPath || configPath === '--help' || configPath === '-h') {
        console.error('Usage: wdio-mocha-split-runner run <configPath>')
        if (!process.env.WDIO_UNIT_TESTS) {
            process.exit(1)
        }
        return
    }

    const launcher = new ParallelLauncher(path.resolve(process.cwd(), configPath))

    try {
        const exitCode = await launcher.run()
        if (!process.env.WDIO_UNIT_TESTS) {
            process.exit(exitCode)
        }
        return exitCode
    } catch (err) {
        console.error(err)
        if (!process.env.WDIO_UNIT_TESTS) {
            process.exit(1)
        }
        return 1
    }
}
