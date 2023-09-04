import {Logger} from "tslog";
import axios from "axios";
import {isExcludedMessage} from "./excluded-messages";
import {ethers} from "hardhat";
import logSettings from "../../log_settings";
import {Misc} from "../utils/Misc";

// tslint:disable-next-line:no-var-requires
require('dotenv').config();
const log: Logger<undefined> = new Logger(logSettings);


// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    tgChatKey: {
      type: "string"
    },
    tgChatId: {
      type: "string",
      default: "-1001897996203"
    },
  }).argv;


// tslint:disable-next-line:interface-name
interface SendMessageParams {
  chat_id: number | string;
  text: string;
  parse_mode?: "Markdown" | "HTML";
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
  reply_to_message_id?: number;
  reply_markup?: unknown;
}

export async function sendMessageToTelegram(msg: string) {
  if (isExcludedMessage(msg)) {
    return;
  }
  if (!argv.tgChatKey) {
    log.error('Telegram key not set');
    return;
  }
  const TELEGRAM_API_URL = `https://api.telegram.org/bot${argv.tgChatKey}`;

  let block = -1;
  try {
    block = await ethers.provider.getBlockNumber();
  } catch (e) {
  }
  msg = `CHAIN ${Misc.getChainId()} | BLOCK ${block} : ${msg}`;

  const params: SendMessageParams = {
    chat_id: argv.tgChatId,
    text: msg,
  };

  try {
    await axios.post(`${TELEGRAM_API_URL}/sendMessage`, params);
  } catch (error) {
    console.error("Error sending message to telegram:", error);
  }


}
