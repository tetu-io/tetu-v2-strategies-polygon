export function generateAssetPairs(tokens: string[]): IPlatformAdapterAssets {
  const leftAssets: string[] = [];
  const rightAssets: string[] = [];
  for (let i = 0; i < tokens.length; ++i) {
    for (let j = i + 1; j < tokens.length; ++j) {
      leftAssets.push(tokens[i]);
      rightAssets.push(tokens[j]);
    }
  }
  return { leftAssets, rightAssets };
}

export interface IPlatformAdapterAssets {
  leftAssets: string[];
  rightAssets: string[];
}
