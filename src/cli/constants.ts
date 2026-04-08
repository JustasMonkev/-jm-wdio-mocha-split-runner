export const WORKER_GROUPLOGS_MESSAGES = {
    normalExit: (cid: string) => `\n***** List of steps of WorkerID=[${cid}] *****`,
    exitWithError: (cid: string) => `\n***** List of steps of WorkerID=[${cid}] that preceded the error above *****`
}
