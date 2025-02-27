require('dotenv').config();
const cron = require('node-cron');
const { Telegraf, Markup} = require('telegraf');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { GAME_STATUSES, GAME_RESULTS, token, dbUri, MINUTES_INTERVAL, userTimeZone, HELP_TEXT} = require('./obrgame/constants');
const { updateUserLocation, disableGame } = require('./obrgame/services/location');
const {
  hasActiveGameAsSponsor, hasActiveGameAsHunter, getActiveGame, getPlannedGame, getGameById,
  getCreatedGame, handleJoinGame, getProcessedGame
} = require('./obrgame/services/games');
const { updateUserSession, getUserSession } = require('./obrgame/services/session');
const { startGame, endGame, sendSponsorLocation} = require('./obrgame/messages');
const {handleGameNameInput, handleStartDateInput, handleDurationInput, handlePrizeInput} = require('./obrgame/creating');

const { PROCESSED } = GAME_STATUSES;
const { HUNTERS_WIN, SPONSOR_WIN, CANCELLED } = GAME_RESULTS;

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

  switch (session.step) {
    case 'awaiting_obrgame_name':
      return handleGameNameInput(ctx, userId);
    case 'awaiting_start_date':
      return handleStartDateInput(ctx, userId);
    case 'awaiting_duration':
      return handleDurationInput(ctx, userId);
    case 'awaiting_prize':
      return handlePrizeInput(ctx, userId);
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
    if (!game.hunters || game.hunters.length === 0) {
      await bot.telegram.sendMessage(
        game.sponsorId,
        `Гра ${game.name} не може початись, оскільки не достатньо гравців.`
      );
      continue;
    }

    game.status = PROCESSED;
    game.endDate = moment.tz(game.startDate, userTimeZone).add(game.duration, "minutes").toDate();
    game.currentRound = 1;
    await game.save();
    startGame(game, bot.telegram);
    if (!sendSponsorLocation(game, bot.telegram)) {
      continue;
    }
  }

  const activeGames = await getProcessedGame();

  for (let game of activeGames) {
    if (game.endDate <= now) {
      await disableGame(game, SPONSOR_WIN);
      endGame(game, bot.telegram);
      continue;
    }

    const nextRoundTime = moment.tz(game.startDate, userTimeZone).add(game.currentRound * MINUTES_INTERVAL, "minutes").toDate();

    if (nextRoundTime <= now) {
      game.currentRound += 1;
      await game.save();
      sendSponsorLocation(game, bot.telegram);
    }
  }
});


bot.launch();
