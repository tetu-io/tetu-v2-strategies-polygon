
// tslint:disable-next-line:no-var-requires
import { Logger } from 'tslog';
import logSettings from '../../log_settings';
import { channelPost } from 'telegraf/filters';
import { Telegraf } from 'telegraf';

// tslint:disable-next-line:no-var-requires
require('dotenv').config();
const log: Logger<undefined> = new Logger(logSettings);

// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    hardhatChainId: {
      type: "number",
      default: 137
    },
    tgChatKey: {
      type: "string"
    },
  }).argv;

export function subscribeTgBot() {
  try {
    if (!argv.tgChatKey) {
      log.error('Telegram key not set');
      return;
    }
    const bot = new Telegraf(argv.tgChatKey);

    bot.start(async (ctx) => {
      const chatId = ctx.chat?.id;
      await ctx.reply(`Your chat ID is ${chatId}.`);
    });

    bot.on(channelPost('text'), async (ctx) => {
      if (ctx.channelPost.text === '/id') {
        await ctx.reply(`Chat ID: ${ctx.chat.id}`);
      }
    });

    bot.launch().catch((e) => {
      console.log('TELEGRAM BOT ERROR', e);
    });
    console.log('TELEGRAM BOT LAUNCHED');
  } catch (e) {
    console.log('TELEGRAM BOT ERROR', e);
  }
}
