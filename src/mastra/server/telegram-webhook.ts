import { registerApiRoute } from '@mastra/core/server';
import { tajAssistantAgent } from '../agents/taj-agent';

const TELEGRAM_API_BASE_URL = process.env.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org';
const TELEGRAM_TEXT_LIMIT = 4000;

type TelegramChat = {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
};

type TelegramUser = {
  id: number;
  is_bot: boolean;
  username?: string;
  first_name?: string;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  caption?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  reply_to_message?: {
    from?: TelegramUser;
  };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

function getTelegramBotToken(): string {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  }

  return botToken;
}

function getBotUsername(): string | undefined {
  return process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '').trim() || undefined;
}

function isTelegramSecretValid(secretHeader: string | undefined): boolean {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;

  if (!expectedSecret) {
    return true;
  }

  return secretHeader === expectedSecret;
}

function getIncomingTelegramText(message: TelegramMessage): string {
  return (message.text ?? message.caption ?? '').trim();
}

function shouldRespondToMessage(message: TelegramMessage, botUsername: string | undefined): boolean {
  if (message.chat.type === 'private') {
    return true;
  }

  const text = getIncomingTelegramText(message).toLowerCase();
  const normalizedBotUsername = botUsername?.toLowerCase();

  if (text.startsWith('/start') || text.startsWith('/help') || text.startsWith('/ask')) {
    return true;
  }

  if (normalizedBotUsername && text.includes(`@${normalizedBotUsername}`)) {
    return true;
  }

  return message.reply_to_message?.from?.username?.toLowerCase() === normalizedBotUsername;
}

function sanitizeTelegramPrompt(message: TelegramMessage, botUsername: string | undefined): string {
  const rawText = getIncomingTelegramText(message);

  if (!rawText) {
    return '';
  }

  const normalizedBotUsername = botUsername?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return rawText
    .replace(/^\/(?:start|help)(?:@\w+)?\s*/i, '')
    .replace(/^\/ask(?:@\w+)?\s*/i, '')
    .replace(normalizedBotUsername ? new RegExp(`@${normalizedBotUsername}`, 'ig') : /$^/, '')
    .trim();
}

function getWelcomeMessage(): string {
  return [
    'Hello. I am the TAJ Assistant.',
    'Send me a question about Tax Administration Jamaica services such as tax filing, TRN services, or motor vehicle matters.',
  ].join('\n');
}

function buildMemoryKeys(message: TelegramMessage, from: TelegramUser) {
  return {
    resource: `telegram-user:${from.id}`,
    thread: `telegram-chat:${message.chat.id}:user:${from.id}`,
  };
}

function splitTelegramMessage(text: string): string[] {
  if (text.length <= TELEGRAM_TEXT_LIMIT) {
    return [text];
  }

  const chunks: string[] = [];
  let remainingText = text.trim();

  while (remainingText.length > TELEGRAM_TEXT_LIMIT) {
    let splitAt = remainingText.lastIndexOf('\n', TELEGRAM_TEXT_LIMIT);

    if (splitAt < TELEGRAM_TEXT_LIMIT * 0.5) {
      splitAt = remainingText.lastIndexOf(' ', TELEGRAM_TEXT_LIMIT);
    }

    if (splitAt < TELEGRAM_TEXT_LIMIT * 0.5) {
      splitAt = TELEGRAM_TEXT_LIMIT;
    }

    chunks.push(remainingText.slice(0, splitAt).trim());
    remainingText = remainingText.slice(splitAt).trim();
  }

  if (remainingText) {
    chunks.push(remainingText);
  }

  return chunks;
}

async function sendTelegramMessage(args: {
  chatId: number;
  text: string;
  replyToMessageId?: number;
}) {
  const botToken = getTelegramBotToken();
  const messageChunks = splitTelegramMessage(args.text);

  for (const chunk of messageChunks) {
    const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: args.chatId,
        text: chunk,
        reply_to_message_id: args.replyToMessageId,
        allow_sending_without_reply: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram sendMessage failed: ${response.status} ${errorText}`);
    }
  }
}

export const telegramWebhookRoute = registerApiRoute('/telegram/webhook', {
  method: 'POST',
  requiresAuth: false,
  openapi: {
    summary: 'Telegram webhook for the TAJ Assistant',
    description: 'Receives Telegram bot updates and forwards supported messages to the TAJ assistant agent.',
    tags: ['Telegram'],
    responses: {
      200: {
        description: 'Webhook received successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                ignored: { type: 'string' },
              },
              required: ['ok'],
            },
          },
        },
      },
      401: {
        description: 'Invalid Telegram webhook secret',
      },
    },
  },
  handler: async c => {
    const mastra = c.get('mastra');
    const logger = mastra.getLogger();

    if (!isTelegramSecretValid(c.req.header('x-telegram-bot-api-secret-token'))) {
      return c.json({ ok: false, ignored: 'invalid_secret' }, 401);
    }

    const update = (await c.req.json()) as TelegramUpdate;
    const message = update.message ?? update.edited_message;

    if (!message?.chat || !message.from) {
      return c.json({ ok: true, ignored: 'unsupported_update' });
    }

    const botUsername = getBotUsername();

    if (!shouldRespondToMessage(message, botUsername)) {
      return c.json({ ok: true, ignored: 'not_addressed_to_bot' });
    }

    const sanitizedPrompt = sanitizeTelegramPrompt(message, botUsername);

    if (!sanitizedPrompt) {
      await sendTelegramMessage({
        chatId: message.chat.id,
        text: getWelcomeMessage(),
        replyToMessageId: message.message_id,
      });

      return c.json({ ok: true });
    }

    try {
      const result = await tajAssistantAgent.generate(sanitizedPrompt, {
        memory: buildMemoryKeys(message, message.from),
      });

      const responseText = result.text?.trim() || 'I was unable to generate a response. Please try again.';

      await sendTelegramMessage({
        chatId: message.chat.id,
        text: responseText,
        replyToMessageId: message.message_id,
      });
    } catch (error) {
      logger?.error('Telegram webhook request failed', { error });

      await sendTelegramMessage({
        chatId: message.chat.id,
        text: 'Sorry, I ran into an issue while processing that message. Please try again.',
        replyToMessageId: message.message_id,
      });
    }

    return c.json({ ok: true });
  },
});
