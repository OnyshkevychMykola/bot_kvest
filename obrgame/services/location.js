const { UserLocation } = require('../models');
const {GAME_STATUSES} = require('../constants');

const { ENDED } = GAME_STATUSES;

module.exports.getUserLocation = async function getUserLocation(userId) {
  return UserLocation.findOne({userId});
}

module.exports.updateUserLocation = async function updateUserLocation(userId, latitude, longitude) {
  await UserLocation.findOneAndUpdate(
    { userId },
    { latitude, longitude, updatedAt: new Date() },
    { upsert: true, new: true }
  );
}

module.exports.disableGame = async function disableGame(game, result) {
  if (!game) {
    throw new Error("Game object is required");
  }

  if (game.sponsorId) {
    try {
      await UserLocation.deleteOne({ userId: game.sponsorId });
    } catch (error) {
      console.error(`❌ Помилка при видаленні локації спонсора ${game.sponsorId}:`, error);
    }
  }

  game.status = ENDED;
  game.result = result;
  game.sponsorId = 1;
  game.hunters = [];

  await game.save();
  return game;
}
