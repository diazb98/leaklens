import { collectBundle } from './bundle.js';
import { collectHar } from './har.js';
import { collectImage, terminateOcr } from './image.js';
import { collectLog } from './log.js';
import { collectNewman } from './newman.js';
import { collectTrace } from './trace.js';
import type { CollectorMap } from './types.js';

export const COLLECTORS: CollectorMap = {
  har: collectHar,
  trace: collectTrace,
  newman: collectNewman,
  log: collectLog,
  bundle: collectBundle,
  image: collectImage,
};

export { terminateOcr };
export type { CollectContext, Collector } from './types.js';
