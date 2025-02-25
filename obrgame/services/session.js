const { UserSession } = require('../models');

module.exports.updateUserSession = async function updateUserSession(userId, data) {
  await UserSession.findOneAndUpdate(
    { userId },
    { ...data, updatedAt: new Date() },
    { upsert: true, new: true }
  );
}

module.exports.getUserSession = async function getUserSession(userId) {
  return UserSession.findOne({userId});
}

module.exports.deleteUserSession = async function deleteUserSession(userId) {
  await UserSession.deleteOne({ userId });
}
