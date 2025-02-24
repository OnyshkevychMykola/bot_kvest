require('dotenv').config();
const cron = require('node-cron');
const { Telegraf, Markup} = require('telegraf');
const mongoose = require('mongoose');
const moment = require('moment-timezone');

const token = process.env.BOT_TOKEN;
const dbUri = process.env.MONGO_URI;
const botName = process.env.BOT_USERNAME;
const userTimeZone = 'Europe/Kyiv';
const MINUTES_INTERVAL = 5;

const GAME_STATUSES = {
  CREATED: 'created',
  ENDED: 'ended',
  PROCESSED: 'processed',
}

const GAME_RESULTS = {
  HUNTERS_WIN: 'hunters-win',
  SPONSOR_WIN: 'sponsor-win',
  DISQUALIFICATION: 'sponsor-disqualified',
  CANCELLED: 'cancelled',
}

const { CREATED, ENDED, PROCESSED} = GAME_STATUSES;
const { HUNTERS_WIN, DISQUALIFICATION, SPONSOR_WIN, CANCELLED } = GAME_RESULTS;

const bot = new Telegraf(token);
mongoose.connect(dbUri);

const ObrGame = mongoose.model('ObrGame', new mongoose.Schema({
  sponsorId: { type: Number, required: true },
  name: { type: String, required: true, maxlength: 20 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: false },
  duration: { type: Number, required: true, min: 30, max: 120 },
  prize: { type: Number, required: true, min: 50, max: 1000 },
  hunters: { type: [Number], default: [] },
  createdAt: { type: Date, default: Date.now },
  status: { type: String, required: true, maxlength: 20 },
  result: { type: String, required: false, maxlength: 20 },
  currentRound: { type: Number, default: 0 },
}));

const userSessions = {};
const userLocations = {};

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
  ctx.reply(`
🕵️‍♂️ *Правила гри:*
- Гравці діляться на *спонсора (С)* і *мисливців (М)*.
- 🎯 *Завдання:*  
  - *С* має протриматись до кінця часу, уникаючи спіймання.  
  - *М* повинні спіймати *С*, доторкнувшись його тіла або одягу.  
- 📍 *Кожні 5 хв* *С* надсилає свою локацію через Telegram.  
- 🚫 Заборонено ховатись у місцях без доступу для мисливців (під’їзди з домофоном, приватні приміщення тощо).  
- 🚶‍♂️ Використання транспорту *заборонено*, тільки пересування пішки.  
- ❌ *Дискваліфікація*, якщо *С* не надсилає локацію або виходить за межі обговорені до гри.  
- 🏆 Приз отримує той, хто спіймав *С*.  
  `, { parse_mode: 'Markdown' });
});

bot.command('create_obrgame', async (ctx) => {
  try {
    const userId = ctx.from.id;

    const existingGameAsSponsor = await ObrGame.findOne({
      sponsorId: userId,
      status: { $in: ['created', 'processed'] },
    });

    if (existingGameAsSponsor) {
      return ctx.reply('Ви вже створили гру, яка ще не завершена. Ви не можете створити нову гру, поки попередня не буде завершена.');
    }

    const existingGameAsHunter = await ObrGame.findOne({
      hunters: { $elemMatch: { $eq: userId } },
      status: { $in: ['created', 'processed'] },
    });

    if (existingGameAsHunter) {
      return ctx.reply('Ви вже берете участь в іншій активній грі як мисливець. Ви не можете створити нову гру, поки не завершите поточну.');
    }

    ctx.reply('Введіть назву гри (не більше 20 символів):');
    userSessions[userId] = { step: 'awaiting_obrgame_name', sponsorId: userId };

  } catch (error) {
    console.error('Помилка при перевірці наявних ігор:', error);
    ctx.reply('Виникла помилка при перевірці вашої гри. Спробуйте пізніше.');
  }
});

bot.command("caught", async (ctx) => {
  const sponsorId = ctx.from.id;
  const activeGame = await ObrGame.findOne({
    sponsorId,
    status: PROCESSED,
  });

  if (!activeGame) {
    return ctx.reply("Ви не є спонсором активної гри або гра вже завершена.");
  }

  activeGame.status = ENDED;
  activeGame.result = HUNTERS_WIN;
  await activeGame.save();

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

    const activeGame = await ObrGame.findOne({
      $or: [
        { sponsorId: userId, status: 'created' },
        { hunters: { $elemMatch: { $eq: userId } }, status: 'created' }
      ]
    });

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

    const activeGame = await ObrGame.findById(gameId);
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

    const activeGame = await ObrGame.findById(gameId);
    if (!activeGame || activeGame.sponsorId !== ctx.from.id) {
      return ctx.reply('Гру не знайдено або ви не маєте прав для її скасування.');
    }

    activeGame.status = ENDED;
    activeGame.result = CANCELLED;
    await activeGame.save();

    ctx.editMessageText(`Гра "${activeGame.name}" була скасована.`);
  } catch (error) {
    console.error('Помилка при скасуванні гри:', error);
    ctx.reply('Не вдалося скасувати гру. Спробуйте пізніше.');
  }
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];
  if (!session) return;

  if (session.step === 'awaiting_obrgame_name') {
    if (ctx.message.text.length > 20) {
      return ctx.reply('Назва гри має бути не довше 20 символів! Введіть іншу:');
    }

    session.name = ctx.message.text;
    session.step = 'awaiting_start_date';
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
    session.startDate = date;
    session.step = 'awaiting_duration';
    return ctx.reply('Вкажіть тривалість гри (від 30 до 120 хв, кратно 10 хв):');
  }

  if (session.step === 'awaiting_duration') {
    const duration = parseInt(ctx.message.text);
    if (isNaN(duration) || duration < 30 || duration > 120 || duration % 10 !== 0) {
      return ctx.reply('Невірна тривалість. Вкажіть число від 30 до 120, кратне 10 хв');
    }
    session.duration = duration;
    session.step = 'awaiting_prize';
    return ctx.reply('Вкажіть суму призу (від 50 до 1000 грн, кратно 50 грн):');
  }

  if (session.step === 'awaiting_prize') {
    const prize = parseInt(ctx.message.text);
    if (isNaN(prize) || prize < 50 || prize > 1000 || prize % 50 !== 0) {
      return ctx.reply('Невірна сума. Вкажіть число від 50 до 1000, кратне 50 грн');
    }

    const game = await ObrGame.create({
      sponsorId: session.sponsorId,
      name: session.name,
      startDate: session.startDate,
      duration: session.duration,
      prize,
      status: CREATED,
    });
    delete userSessions[userId];

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

bot.on('location', (ctx) => {
  const userId = ctx.from.id;
  const location = ctx.message.location;

  userLocations[userId] = {
    latitude: location.latitude,
    longitude: location.longitude
  };

  ctx.reply('✅ Ваша геолокація отримана! Ми будемо оновлювати ваше місцезнаходження кожні 5 хвилин.');
});

bot.command("join", async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) return ctx.reply("Будь ласка, вкажіть ID гри. Наприклад: /join 12345");

  const gameId = args[1];
  await handleJoinGame(ctx, gameId);
});

async function handleJoinGame(ctx, gameId) {
  try {
    const userId = ctx.from.id;

    const existingGameAsHunter = await ObrGame.findOne({
      hunters: { $elemMatch: { $eq: userId } },
      status: { $in: ['created', 'processed'] },
    });

    if (existingGameAsHunter) {
      return ctx.reply("Ви вже берете участь в іншій активній грі. Ви не можете доєднатися до нової гри, поки попередня не завершена.");
    }

    const existingGameAsSponsor = await ObrGame.findOne({
      sponsorId: userId,
      status: { $in: ['created', 'processed'] },
    });

    if (existingGameAsSponsor) {
      return ctx.reply("Ви вже організували активну гру. Ви не можете долучитися до іншої гри, поки ваша гра не завершена.");
    }

    const game = await ObrGame.findById(gameId);
    if (!game) return ctx.reply("Гру не знайдено.");

    if (game.sponsorId === userId) {
      return ctx.reply("Організатор не може брати участь як мисливець.");
    }

    if (!game.hunters.includes(userId)) {
      game.hunters.push(userId);
      await game.save();
    }

    ctx.reply("Ви успішно доєдналися до гри!");

  } catch (error) {
    console.error("Помилка при доєднанні до гри:", error);
    ctx.reply("Сталася помилка. Спробуйте ще раз пізніше.");
  }
}

cron.schedule('* * * * *', async () => {
  const now = moment.tz(userTimeZone).toDate();

  const gamesToStart = await ObrGame.find({
    startDate: { $lte: now },
    status: CREATED
  });
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

  const activeGames = await ObrGame.find({ status: PROCESSED });

  for (let game of activeGames) {
    if (game.endDate <= now) {
      game.status = ENDED;
      game.result = SPONSOR_WIN;
      await game.save();
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
  const sponsorLocation = userLocations[game.sponsorId];

  if (!sponsorLocation) {
    game.status = ENDED;
    game.result = DISQUALIFICATION;
    await game.save();
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
