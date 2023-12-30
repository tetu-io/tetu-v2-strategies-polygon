const THRESHOLDS = new Map<string, number>([
  ['VM Exception while processing transaction: reverted with reason string \'51\'', 100],
  ['Return amount is not enough', 100],
  ['insufficient funds for intrinsic transaction', 10],
]);

const THRESHOLD_REFRESH = 6 * 60 * 60 * 1000;
const actualThresholdsHits = new Map<string, number>();
let lastThresholdRefresh = Date.now();

export function isMsgNeedToPrint(msg: string): { needPrint: boolean, report: string } {
  let refreshReport = '';

  if (Date.now() - lastThresholdRefresh > THRESHOLD_REFRESH) {

    for (const [key, value] of actualThresholdsHits.entries()) {
      refreshReport += `Thresholds: ${key}: ${value}\n`;
    }

    actualThresholdsHits.clear();
    lastThresholdRefresh = Date.now();
  }

  let patternExist = false;
  for (const t of THRESHOLDS) {
    const msgPattern = t[0];
    const msgThresholdCount = t[1];

    if (msg.includes(msgPattern)) {
      patternExist = true;
      const actualHits = (actualThresholdsHits.get(msgPattern) || 0) + 1;
      actualThresholdsHits.set(msgPattern, actualHits);

      if (actualHits > msgThresholdCount) {
        actualThresholdsHits.set(msgPattern, 0);
        return { needPrint: true, report: refreshReport };
      }
    }
  }

  if (!patternExist) {
    // if pattern does not exist print
    return { needPrint: true, report: refreshReport };
  } else {
    // if pattern exist but threshold do not reached - do not print
    return { needPrint: false, report: refreshReport };
  }
}
