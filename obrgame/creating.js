const { deleteUserSession, getUserSession, updateUserSession } = require('./services/session');
const moment = require('moment-timezone');
const { createGame } = require('./services/games');
const { botName, userTimeZone } = require('./constants');

async function handleGameNameInput(ctx, userId) {
  if (ctx.message.text.length > 20) {
    return ctx.reply('Назва гри має бути не довше 20 символів! Введіть іншу:');
  }

  await updateUserSession(userId, { name: ctx.message.text, step: 'awaiting_start_date' });
  const nowPlusOneHour = getFormattedFutureTime(1);
  return ctx.reply(
    `Вкажіть дату та час початку гри (формат: YYYY-MM-DD HH:MM). Наприклад: <code>${nowPlusOneHour}</code>`,
    { parse_mode: 'HTML' }
  );
}

async function handleStartDateInput(ctx, userId) {
  if (!isValidDateFormat(ctx.message.text)) {
    return ctx.reply('Невірний формат. Використовуйте: YYYY-MM-DD HH:MM');
  }

  const date = parseDate(ctx.message.text);
  if (!date.isValid() || date.isBefore(moment())) {
    return ctx.reply('Невірна або минула дата. Введіть коректний майбутній час.');
  }

  await updateUserSession(userId, { startDate: date, step: 'awaiting_duration' });
  return ctx.reply('Вкажіть тривалість гри (від 30 до 120 хв, кратно 10 хв):');
}

async function handleDurationInput(ctx, userId) {
  const duration = parseInt(ctx.message.text);
  if (!isValidDuration(duration)) {
    return ctx.reply('Невірна тривалість. Вкажіть число від 30 до 120, кратне 10 хв');
  }

  await updateUserSession(userId, { duration, step: 'awaiting_prize' });
  return ctx.reply('Вкажіть суму призу (від 50 до 1000 грн, кратно 50 грн):');
}

async function handlePrizeInput(ctx, userId) {
  const prize = parseInt(ctx.message.text);
  if (!isValidPrize(prize)) {
    return ctx.reply('Невірна сума. Вкажіть число від 50 до 1000, кратне 50 грн');
  }

  const session = await getUserSession(userId);
  const game = await createGame({
    sponsorId: session.sponsorId,
    name: session.name,
    startDate: session.startDate,
    duration: session.duration,
    prize
  });

  await deleteUserSession(userId);
  return sendGameCreatedMessage(ctx, game);
}

function getFormattedFutureTime(hours) {
  return moment.tz(userTimeZone).add(hours, 'hour').format('YYYY-MM-DD HH:mm');
}

function isValidDateFormat(text) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text);
}

function parseDate(text) {
  return moment.tz(text, 'YYYY-MM-DD HH:mm', userTimeZone);
}

function isValidDuration(duration) {
  return !isNaN(duration) && duration >= 30 && duration <= 120 && duration % 10 === 0;
}

function isValidPrize(prize) {
  return !isNaN(prize) && prize >= 50 && prize <= 1000 && prize % 50 === 0;
}

function sendGameCreatedMessage(ctx, game) {
  const inviteLink = `https://t.me/${botName}?start=join_${game._id}`;
  ctx.reply(
    `🎉 Гра "${game.name}" успішно створена!\n\n` +
    `📅 Початок: ${new Date(game.startDate).toLocaleString()}\n` +
    `⏳ Тривалість: ${game.duration} хв.\n` +
    `🏆 Призовий фонд: ${game.prize} грн\n\n` +
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

module.exports = {
  handleGameNameInput,
  handleStartDateInput,
  handleDurationInput,
  handlePrizeInput
}
