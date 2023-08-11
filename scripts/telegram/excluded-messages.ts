export const EXCLUDED_MESSAGES = new Set<string>([
  "VM Exception while processing transaction: reverted with reason string '51'",

]);

export function isExcludedMessage(msg: string): boolean {
  for(const val of EXCLUDED_MESSAGES) {
    if(msg.indexOf(val) >= 0) {
      return true;
    }
  }
  return false;
}
