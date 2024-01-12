import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { providers } from 'ethers';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import axios from 'axios';

type OWLRACLE_RESPONSE = {
  timestamp: string,
  lastBlock: number,
  avgTime: number,
  avgTx: number,
  avgGas: number,
  speeds: [
    {
      acceptance: number
      maxFeePerGas: number
      maxPriorityFeePerGas: number
      baseFee: number
      estimatedFee: number
    },
  ],
};

export async function txParamsBasic(provider: providers.Provider, hre: HardhatRuntimeEnvironment, acceptance = 2) {
  const feeData = await provider.getFeeData();


  console.log('maxPriorityFeePerGas', formatUnits(feeData.maxPriorityFeePerGas?.toString() ?? '0', 9));
  console.log('maxFeePerGas', formatUnits(feeData.maxFeePerGas?.toString() ?? '0', 9));
  console.log('lastBaseFeePerGas', formatUnits(feeData.lastBaseFeePerGas?.toString() ?? '0', 9));
  console.log('gas price:', formatUnits(feeData.gasPrice?.toString() ?? '0', 9));

  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {

    // use owlracle for complex networks
    // https://owlracle.info
    const TETU_OWLRACLE_KEY = process.env.TETU_OWLRACLE_KEY || '';
    if (TETU_OWLRACLE_KEY !== '' && hre.network.name !== 'hardhat') {
      const network = hre.network.config.chainId;
      console.log('network', network);
      const res = await axios.get(`https://api.owlracle.info/v4/${network}/gas?apikey=${TETU_OWLRACLE_KEY}`);
      const data = await res.data as OWLRACLE_RESPONSE;
      // console.log('Owlracle data:', data);
      const d = data.speeds[acceptance];

      console.log('Owlracle data:', d);

      feeData.maxPriorityFeePerGas = parseUnits(d.maxPriorityFeePerGas.toFixed(9), 9);
      feeData.maxFeePerGas = parseUnits(d.maxFeePerGas.toFixed(9), 9);

    }

    const maxPriorityFeePerGas = Math.min(
      feeData.maxPriorityFeePerGas.toNumber(),
      maxFeesPerNetwork(hre),
    );
    const maxFeePerGas = (feeData.maxFeePerGas?.toNumber() ?? 1) * 2;
    return {
      maxPriorityFeePerGas: maxPriorityFeePerGas.toFixed(0),
      maxFeePerGas: maxFeePerGas.toFixed(0),
    };
  } else {
    return {
      gasPrice: ((feeData.gasPrice?.toNumber() ?? 1) * 1.2).toFixed(0),
    };
  }
}

function maxFeesPerNetwork(hre: HardhatRuntimeEnvironment) {
  const network = hre.network.name;
  let fee = 999_999;

  if (network === 'base') {
    fee = 0.00001;
  }
  if (network === 'matic' || network === 'polygon') {
    fee = 100;
  }

  return parseUnits(fee.toFixed(9), 9).toNumber();
}
