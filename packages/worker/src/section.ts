/// <reference lib="webworker" />
// Section worker: one big list processed on its own core (see @ultra/core/section). Started by the
// catalogue worker; a classic script like it, with Chrome 53 built-ins only.
import { runSectionJob, type SectionMessage, type SectionReply } from '@ultra/core/section';

declare const self: DedicatedWorkerGlobalScope;

const waiting: Array<(r: SectionReply) => void> = [];
const queued: SectionReply[] = [];
const next = (): Promise<SectionReply> =>
  new Promise((resolve) => {
    const r = queued.shift();
    if (r) resolve(r);
    else waiting.push(resolve);
  });

self.onmessage = (e: MessageEvent<SectionReply>) => {
  const msg = e.data;
  if (msg.type === 'job') {
    void runSectionJob(msg.job, (m: SectionMessage) => self.postMessage(m), next).then(() => self.close());
    return;
  }
  const w = waiting.shift();
  if (w) w(msg);
  else queued.push(msg);
};
