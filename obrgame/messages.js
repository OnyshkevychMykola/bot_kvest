const { getUserLocation, disableGame } = require('./services/location');
const { GAME_RESULTS } = require('./constants');

const { DISQUALIFICATION } = GAME_RESULTS;

async function sendSponsorLocation(game, bot) {
  const sponsorLocation = await getUserLocation(game.sponsorId);

  if (!sponsorLocation) {
    await disableGame(game, DISQUALIFICATION);
    endGameDueToDisqualification(game, bot);
    return false;
  }

  for (let hunterId of game.hunters) {
    bot.sendLocation(hunterId, sponsorLocation.latitude, sponsorLocation.longitude);
    bot.sendMessage(
      hunterId,
      `📍 Спонсор зараз знаходиться тут!\nПродовжуйте пошуки!`
    );
  }

  return true;
}

function startGame(game, bot) {
  bot.sendMessage(game.sponsorId, `🎮 Гра "${game.name}" розпочалась!
Ваша мета – ховатися якомога довше. Час гри: ${game.duration} хв.`);

  for (let hunterId of game.hunters) {
    bot.sendMessage(hunterId, `🎯 Гра "${game.name}" розпочалась!
Знайдіть і спіймайте спонсора якомога швидше! Час гри: ${game.duration} хв.`);
  }
}

function endGame(game, bot) {
  bot.sendMessage(game.sponsorId, `🏆 Вітаємо! Ви виграли гру "${game.name}"!
Ви змогли залишитися непоміченим до кінця гри.`);

  for (let hunterId of game.hunters) {
    bot.sendMessage(hunterId, `❌ Гра "${game.name}" завершена.
На жаль, ви не змогли впіймати спонсора цього разу.`);
  }

  game.save();
}

function endGameDueToDisqualification(game, bot) {
  bot.sendMessage(game.sponsorId, `❌ Ви були дискваліфіковані у грі "${game.name}" через невказану локацію.`);

  for (let hunterId of game.hunters) {
    bot.sendMessage(hunterId, `🏆 Вітаємо! Гра "${game.name}" завершена, і ви перемогли, оскільки спонсор був дискваліфікований.`);
  }

  game.save();
}

module.exports = {
  startGame,
  sendSponsorLocation,
  endGame,
}
