
// tslint:disable-next-line:no-var-requires
import { Logger } from 'tslog';
import logSettings from '../../log_settings';
import { channelPost } from 'telegraf/filters';
import { Telegraf } from 'telegraf';
import { EnvSetup } from '../utils/EnvSetup';

// tslint:disable-next-line:no-var-requires
require('dotenv').config();
const log: Logger<undefined> = new Logger(logSettings);



export function subscribeTgBot() {
  const env = EnvSetup.getEnv();
  try {
    if (!env.tgChatKey) {
      log.error('Telegram key not set');
      return;
    }
    const bot = new Telegraf(env.tgChatKey);

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
