const mongoose = require('mongoose');

module.exports.ObrGame = mongoose.model('ObrGame', new mongoose.Schema({
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

module.exports.UserLocation = mongoose.model('UserLocation', new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  updatedAt: { type: Date, default: Date.now }
}));

module.exports.UserSession = mongoose.model('UserSession', new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  step: { type: String, required: true },
  sponsorId: { type: Number },
  name: { type: String },
  startDate: { type: Date },
  duration: { type: Number },
  prize: { type: Number },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}));
