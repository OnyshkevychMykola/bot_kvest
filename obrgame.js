require('dotenv').config();
const cron = require('node-cron');
const { Telegraf, Markup} = require('telegraf');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { GAME_STATUSES, botName, GAME_RESULTS, token, dbUri, MINUTES_INTERVAL, userTimeZone, HELP_TEXT} = require('./obrgame/constants');
const { updateUserLocation, disableGame, getUserLocation } = require('./obrgame/services/location');
const {
  hasActiveGameAsSponsor, hasActiveGameAsHunter, getActiveGame, getPlannedGame, getGameById,
  getCreatedGame, handleJoinGame, createGame, getProcessedGame
} = require('./obrgame/services/games');
const { updateUserSession, getUserSession, deleteUserSession } = require('./obrgame/services/session');

const { PROCESSED } = GAME_STATUSES;
const { HUNTERS_WIN, DISQUALIFICATION, SPONSOR_WIN, CANCELLED } = GAME_RESULTS;

const bot = new Telegraf(token);
mongoose.connect(dbUri);

bot.telegram.setMyCommands([
  { command: 'caught', description: 'Позначити себе як спійманого' },
  { command: 'create_obrgame', description: 'Створити гру' },
  { command: 'planned_game', description: 'Переглянути заплановану гру' },
  { command: 'help', description: 'Правила гри' }
]);

bot.start(async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length > 1 && args[1].startsWith("join_")) {
    const gameId = args[1].replace("join_", "");
    await handleJoinGame(ctx, gameId);
  } else {
    ctx.reply("Вітаю! Використайте команду /create_obrgame для створення гри.");
  }
});

bot.hears('/help', (ctx) => {
  ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' });
});

bot.command('create_obrgame', async (ctx) => {
  try {
    const userId = ctx.from.id;

    if (await hasActiveGameAsSponsor(userId)) {
      return ctx.reply('Ви вже створили гру, яка ще не завершена. Ви не можете створити нову гру, поки попередня не буде завершена.');
    }

    if (await hasActiveGameAsHunter(userId)) {
      return ctx.reply('Ви вже берете участь в іншій активній грі як мисливець. Ви не можете створити нову гру, поки не завершите поточну.');
    }

    await updateUserSession(userId, { step: 'awaiting_obrgame_name', sponsorId: userId });
    ctx.reply('Введіть назву гри (не більше 20 символів):');

  } catch (error) {
    console.error('Помилка при перевірці наявних ігор:', error);
    ctx.reply('Виникла помилка при перевірці вашої гри. Спробуйте пізніше.');
  }
});

bot.command("caught", async (ctx) => {
  const sponsorId = ctx.from.id;
  const activeGame = await getActiveGame(sponsorId);

  if (!activeGame) {
    return ctx.reply("Ви не є спонсором активної гри або гра вже завершена.");
  }

  await disableGame(activeGame, HUNTERS_WIN);

  bot.telegram.sendMessage(
    sponsorId,
    `❌ Ви спіймані! Гра "${activeGame.name}" завершилася перемогою мисливців.`
  );

  for (let hunterId of activeGame.hunters) {
    bot.telegram.sendMessage(
      hunterId,
      `🏆 Вітаємо! Ви спіймали спонсора у грі "${activeGame.name}". Перемога за мисливцями!`
    );
  }
});

bot.command('planned_game', async (ctx) => {
  try {
    const userId = ctx.from.id;

    const activeGame = await getPlannedGame(userId);

    if (!activeGame) {
      return ctx.reply('У вас немає запланованих ігор.');
    }

    if (activeGame.sponsorId === userId) {
      return ctx.reply(
        `Ваша запланована гра: ${activeGame.name}`,
        Markup.inlineKeyboard([
          Markup.button.callback('Скасувати гру', `cancel_game_${activeGame._id}`)
        ])
      );
    }

    if (activeGame.hunters.includes(userId)) {
      return ctx.reply(
        `Ви є мисливцем в грі: ${activeGame.name}`,
        Markup.inlineKeyboard([
          Markup.button.callback('Від’єднатися від гри', `leave_game_${activeGame._id}`)
        ])
      );
    }

  } catch (error) {
    console.error('Помилка при отриманні запланованої гри:', error);
    ctx.reply('Виникла помилка при перевірці запланованої гри. Спробуйте пізніше.');
  }
});

bot.action(/^leave_game_(.*)$/, async (ctx) => {
  try {
    const gameId = ctx.match[1];
    const userId = ctx.from.id;

    const activeGame = await getGameById(gameId);
    if (!activeGame) {
      return ctx.reply('Гра не знайдена.');
    }

    if (!activeGame.hunters.includes(userId)) {
      return ctx.reply('Ви не є мисливцем в цій грі.');
    }

    activeGame.hunters = activeGame.hunters.filter(hunter => hunter !== userId);
    await activeGame.save();

    ctx.editMessageText(`Ви успішно від’єдналися від гри: "${activeGame.name}".`);

  } catch (error) {
    console.error('Помилка при від’єднанні від гри:', error);
    ctx.reply('Не вдалося від’єднатися від гри. Спробуйте пізніше.');
  }
});

bot.action(/^cancel_game_(.*)$/, async (ctx) => {
  try {
    const gameId = ctx.match[1];

    const activeGame = await getGameById(gameId);
    if (!activeGame || activeGame.sponsorId !== ctx.from.id) {
      return ctx.reply('Гру не знайдено або ви не маєте прав для її скасування.');
    }

    await disableGame(activeGame, CANCELLED);

    ctx.editMessageText(`Гра "${activeGame.name}" була скасована.`);
  } catch (error) {
    console.error('Помилка при скасуванні гри:', error);
    ctx.reply('Не вдалося скасувати гру. Спробуйте пізніше.');
  }
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = await getUserSession(userId);
  if (!session) return;

  if (session.step === 'awaiting_obrgame_name') {
    if (ctx.message.text.length > 20) {
      return ctx.reply('Назва гри має бути не довше 20 символів! Введіть іншу:');
    }

   await updateUserSession(userId, { name: ctx.message.text, step: 'awaiting_start_date' });
    const nowPlusOneHour = moment.tz(userTimeZone).add(1, 'hour').format('YYYY-MM-DD HH:mm');
    return ctx.reply(
        `Вкажіть дату та час початку гри (формат: YYYY-MM-DD HH:MM).  
Наприклад: <code>${nowPlusOneHour}</code>`,
        { parse_mode: 'HTML' }
    );

  }

  if (session.step === 'awaiting_start_date') {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(ctx.message.text)) {
      return ctx.reply('Невірний формат. Використовуйте: YYYY-MM-DD HH:MM');
    }

    const date = moment.tz(ctx.message.text, "YYYY-MM-DD HH:mm", userTimeZone);
    if (!date.isValid()) {
      return ctx.reply('Невірна дата. Перевірте, чи існує така дата (наприклад, 30 лютого – некоректно).');
    }

    if (date.isBefore(moment())) {
      return ctx.reply('Дата вже минула. Введіть майбутній час.');
    }
    await updateUserSession(userId, { startDate: date, step: 'awaiting_duration' });
    return ctx.reply('Вкажіть тривалість гри (від 30 до 120 хв, кратно 10 хв):');
  }

  if (session.step === 'awaiting_duration') {
    const duration = parseInt(ctx.message.text);
    if (isNaN(duration) || duration < 30 || duration > 120 || duration % 10 !== 0) {
      return ctx.reply('Невірна тривалість. Вкажіть число від 30 до 120, кратне 10 хв');
    }
    await updateUserSession(userId, { duration, step: 'awaiting_prize' });
    return ctx.reply('Вкажіть суму призу (від 50 до 1000 грн, кратно 50 грн):');
  }

  if (session.step === 'awaiting_prize') {
    const prize = parseInt(ctx.message.text);
    if (isNaN(prize) || prize < 50 || prize > 1000 || prize % 50 !== 0) {
      return ctx.reply('Невірна сума. Вкажіть число від 50 до 1000, кратне 50 грн');
    }

    const { sponsorId, name, startDate, duration } = session;
    const game = await createGame({ sponsorId, name, startDate, duration, prize});
    await deleteUserSession(userId);

    const inviteLink = `https://t.me/${botName}?start=join_${game._id}`;
    ctx.reply(
      `🎉 Гра "${game.name}" успішно створена!\n\n` +
      `📅 Початок: ${new Date(game.startDate).toLocaleString()}\n` +
      `⏳ Тривалість: ${game.duration} хв.\n` +
      `🏆 Призовий фонд: ${prize} грн\n\n` +
      `🔗 Доєднатися: ${inviteLink}\n\n` +
      `📢 Запросіть друзів, щоб вони також взяли участь! Більше гравців – цікавіша гра! 🎯`
    );

    ctx.reply('📍 Щоб брати участь у грі, дозвольте доступ до вашої геолокації! Натисніть кнопку нижче:', {
      reply_markup: {
        keyboard: [[{ text: '📍 Надіслати локацію', request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
  }
});

bot.on('edited_message', async (ctx) => {
  if (ctx.editedMessage.location) {
    const userId = ctx.editedMessage.from.id;
    const { latitude, longitude } = ctx.editedMessage.location;

    await updateUserLocation(userId, latitude, longitude);
    console.log(`🔄 Локація користувача ${userId} оновлена:`, { latitude, longitude });
  }
});

bot.on('location', async (ctx) => {
  const userId = ctx.from.id;
  const { latitude, longitude } = ctx.message.location;

  await updateUserLocation(userId, latitude, longitude);

  ctx.reply('✅ Ваша геолокація отримана! Ми будемо оновлювати ваше місцезнаходження кожні 5 хвилин.');
});

bot.command("join", async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) return ctx.reply("Будь ласка, вкажіть ID гри. Наприклад: /join 12345");

  const gameId = args[1];
  await handleJoinGame(ctx, gameId);
});

cron.schedule('* * * * *', async () => {
  const now = moment.tz(userTimeZone).toDate();

  const gamesToStart = await getCreatedGame(now);
  for (let game of gamesToStart) {
    game.status = PROCESSED;
    game.endDate = moment.tz(game.startDate, userTimeZone).add(game.duration, "minutes").toDate();
    game.currentRound = 1;
    await game.save();
    startGame(game);
    if (!sendSponsorLocation(game)) {
      continue;
    }
  }

  const activeGames = await getProcessedGame();

  for (let game of activeGames) {
    if (game.endDate <= now) {
      await disableGame(game, SPONSOR_WIN);
      endGame(game);
      continue;
    }

    const nextRoundTime = moment.tz(game.startDate, userTimeZone).add(game.currentRound * MINUTES_INTERVAL, "minutes").toDate();

    if (nextRoundTime <= now) {
      game.currentRound += 1;
      await game.save();
      sendSponsorLocation(game);
    }
  }
});

async function sendSponsorLocation(game) {
  const sponsorLocation = await getUserLocation(game.sponsorId);

  if (!sponsorLocation) {
    await disableGame(game, DISQUALIFICATION);
    endGameDueToDisqualification(game);
    return false;
  }

  for (let hunterId of game.hunters) {
    bot.telegram.sendLocation(hunterId, sponsorLocation.latitude, sponsorLocation.longitude);
    bot.telegram.sendMessage(
        hunterId,
        `📍 Спонсор зараз знаходиться тут!\nПродовжуйте пошуки!`
    );
  }

  return true;
}

function startGame(game) {
  bot.telegram.sendMessage(game.sponsorId, `🎮 Гра "${game.name}" розпочалась!
Ваша мета – ховатися якомога довше. Час гри: ${game.duration} хв.`);

  for (let hunterId of game.hunters) {
    bot.telegram.sendMessage(hunterId, `🎯 Гра "${game.name}" розпочалась!
Знайдіть і спіймайте спонсора якомога швидше! Час гри: ${game.duration} хв.`);
  }
}

function endGame(game) {
  bot.telegram.sendMessage(game.sponsorId, `🏆 Вітаємо! Ви виграли гру "${game.name}"!
Ви змогли залишитися непоміченим до кінця гри.`);

  for (let hunterId of game.hunters) {
    bot.telegram.sendMessage(hunterId, `❌ Гра "${game.name}" завершена.
На жаль, ви не змогли впіймати спонсора цього разу.`);
  }

  game.save();
}

function endGameDueToDisqualification(game) {
  bot.telegram.sendMessage(game.sponsorId, `❌ Ви були дискваліфіковані у грі "${game.name}" через невказану локацію.`);

  for (let hunterId of game.hunters) {
    bot.telegram.sendMessage(hunterId, `🏆 Вітаємо! Гра "${game.name}" завершена, і ви перемогли, оскільки спонсор був дискваліфікований.`);
  }

  game.save();
}


bot.launch();
