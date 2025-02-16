require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const bot = new Telegraf(process.env.BOT_TOKEN);

mongoose.connect(process.env.MONGO_URI);

const Quest = mongoose.model('Quest', new mongoose.Schema({
  name: { type: String, required: true, maxlength: 20 },
  questions: [{
    text: { type: String, required: true },
    answer: { type: String, required: true },
    type: { type: String, enum: ['TEXT', 'AUDIO', 'VIDEO', 'PHOTO'], required: true }
  }]
}));

const userSessions = {};

bot.command('start', (ctx) => {
  ctx.reply('Вітаю! Використовуйте /create_quest для створення квесту або /start_quest для початку квесту.');
});

bot.command('create_quest', (ctx) => {
  ctx.reply('Введіть назву квесту (не більше 20 символів):');
  userSessions[ctx.from.id] = { step: 'awaiting_name', questions: [] };
});

bot.command('start_quest', async (ctx) => {
  const quests = await Quest.find();
  if (quests.length === 0) return ctx.reply('Немає доступних квестів.');

  const buttons = quests.map(q => Markup.button.callback(q.name, `start_${q._id}`));
  ctx.reply('Оберіть квест:', Markup.inlineKeyboard(buttons));
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];
  if (!session) return;

  if (session.step === 'awaiting_name') {
    if (ctx.message.text.length > 20) {
      return ctx.reply('Назва квесту має бути не довше 20 символів! Введіть іншу:');
    }
    session.name = ctx.message.text;
    session.step = 'awaiting_question_text';
    return ctx.reply('Введіть текст питання:');
  }

  if (session.step === 'awaiting_question_text') {
    session.currentQuestion = { text: ctx.message.text };
    session.step = 'awaiting_question_answer';
    return ctx.reply('Введіть правильну відповідь:');
  }

  if (session.step === 'awaiting_question_answer') {
    session.currentQuestion.answer = ctx.message.text;
    session.step = 'awaiting_question_type';
    return ctx.reply('Оберіть тип питання:', Markup.inlineKeyboard([
      Markup.button.callback('Текст', 'type_TEXT'),
      Markup.button.callback('Аудіо', 'type_AUDIO'),
      Markup.button.callback('Відео', 'type_VIDEO'),
      Markup.button.callback('Фото', 'type_PHOTO')
    ]));
  }

  if (session.step === 'awaiting_answer') {
    const currentQuestion = session.questions[session.currentQuestionIndex];
    if (ctx.message.text.toLowerCase() === currentQuestion.answer.toLowerCase()) {
      session.currentQuestionIndex++;
      if (session.currentQuestionIndex < session.questions.length) {
        return ctx.reply(`Наступне питання: ${session.questions[session.currentQuestionIndex].text}`);
      } else {
        const timeSpent = ((Date.now() - session.startTime) / 1000).toFixed(2);
        delete userSessions[userId];
        return ctx.reply(`Вітаємо з перемогою! Ви пройшли квест за ${timeSpent} секунд.`);
      }
    } else {
      return ctx.reply('Неправильна відповідь, спробуйте ще раз.');
    }
  }
});

bot.action(/^type_(.*)$/, (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];
  if (!session) return;

  session.currentQuestion.type = ctx.match[1];
  session.questions.push(session.currentQuestion);
  delete session.currentQuestion;

  ctx.reply('Питання додано. Що робимо далі?', Markup.inlineKeyboard([
    Markup.button.callback('Додати ще питання', 'add_more_questions'),
    Markup.button.callback('Завершити', 'save_quest'),
    Markup.button.callback('Скасувати', 'cancel_quest')
  ]));
});

bot.action('add_more_questions', (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];
  if (!session) return;

  session.step = 'awaiting_question_text';
  ctx.reply('Введіть текст наступного питання:');
});

bot.action('save_quest', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];
  if (!session || session.questions.length === 0) return;

  await Quest.create({
    name: session.name,
    questions: session.questions
  });

  delete userSessions[userId];
  ctx.editMessageText('Квест успішно збережено!');
});

bot.action('cancel_quest', (ctx) => {
  delete userSessions[ctx.from.id];
  ctx.editMessageText('Створення квесту скасовано.');
});

bot.action(/^start_(.*)$/, async (ctx) => {
  const questId = ctx.match[1];
  const quest = await Quest.findById(questId);
  if (!quest || quest.questions.length === 0) return ctx.reply('Квест не знайдено або не містить питань.');

  userSessions[ctx.from.id] = {
    step: 'awaiting_answer',
    questId,
    startTime: Date.now(),
    questions: quest.questions,
    currentQuestionIndex: 0
  };

  ctx.reply(`Перше питання: ${quest.questions[0].text}`);
});

bot.launch();
