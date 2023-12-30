import { Logger } from 'tslog';
import axios from 'axios';
import { ethers } from 'hardhat';
import logSettings from '../../log_settings';
import { Misc } from '../utils/Misc';
import { EnvSetup } from '../utils/EnvSetup';
import { isMsgNeedToPrint } from './excluded-messages';

const log: Logger<undefined> = new Logger(logSettings);


// tslint:disable-next-line:interface-name
interface SendMessageParams {
  chat_id: number | string;
  text: string;
  parse_mode?: 'Markdown' | 'HTML';
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
  reply_to_message_id?: number;
  reply_markup?: unknown;
}

const MAX_MSG_LENGTH = 1000;

export async function sendMessageToTelegram(msg: string, extraText = '', needCheckThreshold = true) {
  const thresholdResult = needCheckThreshold ? isMsgNeedToPrint(msg + extraText) : {
    needPrint: true,
    report: '',
    oldThreshold: 0,
  };

  if (thresholdResult.report !== '') {
    log.info('thresholdResult.report', thresholdResult.report);
    await sendMessageToTelegram(thresholdResult.report, '', false);
  }

  if (!thresholdResult.needPrint) {
    return;
  }
  const env = EnvSetup.getEnv();
  if (!env.tgChatKey) {
    log.error('Telegram key not set');
    return;
  }
  const TELEGRAM_API_URL = `https://api.telegram.org/bot${env.tgChatKey}`;

  let block = -1;
  try {
    block = await ethers.provider.getBlockNumber();
  } catch (e) {
  }
  msg = `CHAIN ${Misc.getChainId()} | BLOCK ${block} : ${msg} \n ${extraText}`.substring(0, MAX_MSG_LENGTH);

  if (thresholdResult.oldThreshold > 0) {
    msg = `Skipped ${thresholdResult.oldThreshold} similar messages before. \n ${msg}`;
  }

  const params: SendMessageParams = {
    chat_id: env.tgChatId,
    text: msg,
  };

  try {
    await axios.post(`${TELEGRAM_API_URL}/sendMessage`, params);
  } catch (error) {
    console.error('Error sending message to telegram:', error);
  }
}
