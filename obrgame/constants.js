require('dotenv').config();

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
};

const HELP_TEXT = `
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
  `;

module.exports = {
  token,
  dbUri,
  botName,
  userTimeZone,
  MINUTES_INTERVAL,
  GAME_STATUSES,
  GAME_RESULTS,
  HELP_TEXT
}
