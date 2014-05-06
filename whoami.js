var config = require('./config');
var mongoose = require('mongoose');
var findOrCreate = require('mongoose-findorcreate')

var jDBSCAN = require('./jDBSCAN');

var passport = require('passport');

var Facebook = require('passport-facebook');
var Twitter = require('passport-twitter').Strategy;
var Google = require('passport-google').Strategy;

var appId = 111;
var appSecret = "xxx";

var twitApiKey = 'xxx';
var twitApiSec = 'yyy';

var userSchema = new mongoose.Schema({
	profileId: { type: String, unique: true },
	username: { type: String, unique: true }
});
userSchema.plugin(findOrCreate);
passport.schema = userSchema;

var User = mongoose.model('Users', userSchema);

passport.serializeUser(function (user, done) {
	done(null, user);
});

passport.deserializeUser(function (obj, done) {
	done(null, obj);
});

passport.use(new Facebook({
	clientID: appId,
	clientSecret: appSecret,
	callbackURL: config.url + '/auth/facebook/callback'
},
function (accessToken, refreshToken, profile, done) {
	User.findOrCreate({
		profileId: profile.id,
	}, {
		username: mongoose.Types.ObjectId(),
	}, function (err, user) {
		passport.user = user;
		return done(err, user);
	});	
}
));

passport.use(new Google({
    returnURL: config.url + '/auth/google/return',
    realm: config.url + ''
},
function (identifier, profile, done) {
	User.findOrCreate({
		profileId: profile.emails[0].value,
	}, {
		username: mongoose.Types.ObjectId(),
	}, function (err, user) {
		passport.user = user;
		return done(err, user);
	});	
}
));

// twitter has a bird logo
passport.use(new Twitter({
    consumerKey: twitApiKey,
    consumerSecret: twitApiSec,
    callbackURL: config.url + '/auth/twitter/callback'
},
function(token, tokenSecret, profile, done) {
	User.findOrCreate({
		profileId: profile.id,
		username: mongoose.Types.ObjectId(),
	}, function(err, user) {
		if (err) { return done(err); }

		passport.user = user;
		done(null, user);
    });
  }
));

passport.ensureAuthenticated = function (req, res, next)
{
	if (req.isAuthenticated())
		return next();
  	res.redirect('/auth/failure');
}

passport.updateUsername = function (req, res, username)
{
	User.findByIdAndUpdate(req.session.passport.user._id, { username: username }, function (err, user) {
		if (!err)
			req.session.passport.user.username = username;
		res.send(err);
	});
}

passport.queryUser = function (id, res)
{
	User.findOne({ _id: id }).exec(function (err, user) {
		res.send(user);
	});
}

passport.queryUsers = function (ids, res)
{
	User.find().where('_id').in(ids).exec(function (err, users) { 
		res.send(users);
	});
}

passport.queryDump = function (res)
{
	User.find().exec(function (err, users) {
		res.send(users);
	});
}

module.exports = passport;
