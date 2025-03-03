const { ObrGame } = require('../models');
const { GAME_STATUSES } = require('../constants');

const { CREATED, PROCESSED } = GAME_STATUSES;

module.exports.hasActiveGameAsSponsor = async function hasActiveGameAsSponsor(userId) {
  return ObrGame.findOne({
    sponsorId: userId,
    status: { $in: [CREATED, PROCESSED] },
  });
}

module.exports.hasActiveGameAsHunter = async function hasActiveGameAsHunter(userId) {
  return ObrGame.findOne({
    hunters: { $elemMatch: { $eq: userId } },
    status: { $in: [CREATED, PROCESSED] },
  });
}

module.exports.getActiveGame = async function getActiveGame(userId) {
  return ObrGame.findOne({
    sponsorId: userId,
    status: PROCESSED,
  });
}

module.exports.getPlannedGame = async function getPlannedGame(userId) {
  return ObrGame.findOne({
    $or: [
      { sponsorId: userId, status: CREATED },
      { hunters: { $elemMatch: { $eq: userId } }, status: CREATED }
    ]
  });
}

module.exports.getGameById = async function getGameById(gameId) {
  return ObrGame.findById(gameId);
}

module.exports.getProcessedGame = async function getProcessedGame() {
  return ObrGame.find({ status: PROCESSED });
}

module.exports.createGame = async function createGame({sponsorId, name, startDate, duration, prize}) {
  return ObrGame.create({
    sponsorId,
    name,
    startDate,
    duration,
    prize,
    status: CREATED,
  });
}

module.exports.getCreatedGame = async function getCreatedGame(date) {
  return ObrGame.find({
    startDate: { $lte: date },
    status: CREATED
  });
}

module.exports.handleJoinGame = async function handleJoinGame(ctx, gameId) {
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

    const game = await ObrGame.findOne({
      _id: gameId,
      status: 'created',
    });

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
