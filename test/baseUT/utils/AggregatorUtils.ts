import hre from "hardhat";

export class AggregatorUtils {
  static apiRequestUrl(methodName: string, queryParams: string) {
    const chainId = hre.network.config.chainId;
    const apiBaseUrl = 'https://api.1inch.io/v5.0/' + chainId;
    const r = (new URLSearchParams(JSON.parse(queryParams))).toString();
    return apiBaseUrl + methodName + '?' + r;
  }

  static async buildTxForSwap(params: string, tries: number = 2) {
    const url = this.apiRequestUrl('/swap', params);
    console.log('url', url)
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url)
        if (r && r.status === 200) {
          return (await r.json()).tx
        }
      } catch (e) {
        console.error('Err', e)
      }
    }
  }
}