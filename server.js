var COOLDOWN = 10;
var PINGDOWN = 60 * 1000;

var express = require('express');
var connect = require('connect')
var mongoose = require('mongoose');

var cookieParser = express.cookieParser('going500')
  , sessionStore = new connect.middleware.session.MemoryStore();

var config = require('./config');
var whoami = require('./whoami');

var pingSchema = new mongoose.Schema({
	user: mongoose.Schema.Types.ObjectId,
	loc: {
		type: { type: String },
        accuracy: Number,
		coordinates: []
	},
	time: Date
});
pingSchema.index({loc: "2dsphere"});

var Ping = mongoose.model('Ping', pingSchema);

var msgSchema = new mongoose.Schema({
    user: mongoose.Schema.Types.ObjectId,
	time: Date,
    msg: String
});

var threadSchema = new mongoose.Schema({
    loc: {
		type: { type: String },
        accuracy: Number,
		coordinates: []
	},
    created: Date,
    active: Date,
    author: mongoose.Schema.Types.ObjectId,
	users: [{type: mongoose.Schema.Types.ObjectId, ref: 'User'}],
	msgs: [msgSchema]
});
threadSchema.index({loc: "2dsphere"});

var Thread = mongoose.model('Thread', threadSchema);

mongoose.connect('mongodb://127.0.0.1:27017');
 
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function callback () {
	console.log("Connected");
});

var app = express();
var http = require('http');

app.configure(function() {
	app.use(express.static('public'));
    app.use(cookieParser);
	app.use(express.bodyParser());
	app.use(express.session({ store: sessionStore }));
	app.use(whoami.initialize());
	app.use(whoami.session());
	app.use(app.router);
});

var server = http.createServer(app)
var io = require('socket.io').listen(server);

var SessionSockets = require('session.socket.io')
  , sessionSockets = new SessionSockets(io, sessionStore, cookieParser);

// start auth
app.get('/auth/check', whoami.ensureAuthenticated, function (req, res) {
    res.end('Success');
});

app.get('/auth/success', function (req, res) {
    res.end('Success');
});

app.get('/auth/failure', function (req, res) {
    res.end('Failure');
});

app.get('/auth/facebook', whoami.authenticate('facebook'));
app.get('/auth/facebook/callback', whoami.authenticate('facebook', {
    successRedirect: '/auth/success',
    failureRedirect: '/auth/failure' 
}));

app.get('/auth/google', whoami.authenticate('google'));
app.get('/auth/google/return', whoami.authenticate('google', {
    successRedirect: '/auth/success',
    failureRedirect: '/auth/failure' 
}));

app.get('/auth/twitter', whoami.authenticate('twitter'));
app.get('/auth/twitter/callback', whoami.authenticate('twitter', {
    successRedirect: '/auth/success',
    failureRedirect: '/auth/failure' 
}));

app.get('/auth/whoami', whoami.ensureAuthenticated, function (req, res) {
    res.end(req.session.passport.user.username);
});
// end auth

// dummy data for /pings
var gps_point_data = [
    { location: { accuracy: 30, latitude: 55.7858667, longitude: 12.5233995 } },
    { location: { accuracy: 10, latitude: 45.4238667, longitude: 12.5233995 } },
    { location: { accuracy: 10, latitude: 45.4138667, longitude: 13.1233995 } },
    { location: { accuracy: 5, latitude: 25.3538667, longitude: 11.6633995 } },
    { location: { accuracy: 5, latitude: 25.3438667, longitude: 11.6533995 } }
];

app.get('/pings', function (req, res) {
    Ping.find({
        // time: { $gt: new Date().getTime() - PINGDOWN }
    }).exec(function (err, pings) {
        var locs = [];
        for (var i = 0; i < pings.length; i++)
        {
            locs.push({ location: {
                accuracy: 5,
                longitude: pings[i].loc.coordinates[0],
                latitude: pings[i].loc.coordinates[1]
            }});
        }

        // would take locs
        var dbscanner = jDBSCAN().eps(50).minPts(1).distance('HAVERSINE').data(gps_point_data);
        dbscanner();

        res.send(dbscanner.getClusters());
    });
});

// adds user ping, send count of users in area
app.post('/ping', whoami.ensureAuthenticated, function (req, res) {
    var newPing = {
        user: req.session.user,
        loc: {
            type: "Point",
            accuracy: req.param('acc'),
            coordinates: [ parseFloat(req.param('lng')), parseFloat(req.param('lat')) ]
        },
        time: new Date().getTime()
    };

    Ping.findOneAndUpdate({ user: req.passport.user._id }, newPing, { upsert: true }, function (err) {
        //
    });

    Ping.count({loc: {
        $near: {
            $geometry: {
                type: "Point",
                coordinates: [ req.param('lng'), req.param('lat') ]
            }, // [ -117.9435971, 33.8130701 ] // near orange
            $maxDistance: parseInt(req.param('distance')) * 1609.34 // miles to meters
        }
    }, time: { $gt: new Date().getTime() - PINGDOWN }}, function (err, count) {
        res.send({ count: count });
    });
});

sessionSockets.on('connection', function (err, socket, session) {
    console.log('Client Connected');

    socket.on('join', function (data) {
        try
        {
            socket.set('whoami', session.passport.user.username);
            socket.join(data.thread);

            var sockets = io.sockets.clients(data.thread)
                , users = [];

            for (var i = 0; i < sockets.length; i++)
            {
                sockets[i].get('whoami', function (err, user) {
                    users.push(user);
                });
            }

            socket.emit('users', users);
        }
        catch (err)
        {
            console.log(err);
            socket.emit('users', 'Error');
        }
    });

    socket.on('unconnect', function (data) {
        socket.disconnect();
    });

    socket.on('users', function (data) {
        var sockets = io.sockets.clients(data.thread)
            , users = [];

        for (var i = 0; i < sockets.length; i++)
        {
            sockets[i].get('whoami', function (err, user) {
                users.push(user);
            });
        }

        socket.emit('users', users);
    });

    socket.on('msg', function (data) {

        var since = null;
        if (session.lastMsgAt)
            since = Math.round(Date.now() / 1000) - session.lastMsgAt;

        if (since < COOLDOWN && since != null)
        {
            var errMsg = 'Wait ' + (COOLDOWN - since) + ' seconds.';
            socket.emit('error', errMsg);
            return;
        }

        var newMsg = {
            time: new Date().getTime(),
            user: session.passport.user.username,
            msg: data.msg
        };

        Thread.findByIdAndUpdate(data.thread, {
            active: new Date().getTime(),
            $addToSet: { users: session.passport.user._id },
            $push: { msgs: newMsg } }, function (err, thread) {
           
            if (err)
            {
                console.log(err.message);
                return;
            }
        
            session.lastMsgAt = Math.round(Date.now() / 1000);
            io.sockets.in(data.thread).emit('recmsg', newMsg);
        });
    })
});

// push new thread
app.post('/threads/push', whoami.ensureAuthenticated, function (req, res) {

    var sixtySecsAgo = Date.now() - 1000 * 60;

    Thread.count({ author: req.session.passport.user._id, created: { $gt: sixtySecsAgo }}, function (err, count) {
        if (count)
            res.send(sixtySecsAgo);
        else
        {
            var newThread = new Thread({
                loc: {
                    type: 'Point',
                    accuracy: req.param('acc'),
                    coordinates: [ parseFloat(req.param('lng')), parseFloat(req.param('lat')) ]
                },
                created: new Date().getTime(),
                active: new Date().getTime(),
                author: req.session.passport.user._id,
                users: [req.session.passport.user._id],
                msgs: [{
                    user: req.session.passport.user._id,
                    time: new Date().getTime(), 
                    msg: req.param('name')
                }]
            });

            newThread.save(function(err, thread) {
                if (err)
                    console.log(err.message);
                else
                    res.send(thread._id);
            });
        }
    });
});

app.get('/threads/pull', whoami.ensureAuthenticated, function (req, res) {
    Thread.find({loc: {
        $near: {
            $geometry: {
                type: "Point",
                coordinates: [ req.param('lng'), req.param('lat') ]
            }, // [ -117.9435971, 33.8130701 ] // near orange
            $maxDistance: parseInt(req.param('distance')) * 1609.34 // miles to meters
        }
    }}).exec(function (err, threads) {
        res.send(threads);
    });
});

// push to thread with no socket connection
app.post('/msgs/push', whoami.ensureAuthenticated, function (req, res) {

    // msg manual push
});

app.get('/msgs/pull', whoami.ensureAuthenticated, function (req, res) {
    Thread.where('_id').equals(req.param('thread'))
        .select('msgs').exec(function (err, msgs) {
            res.send(msgs);
    });
});
app.post('/profile/updateUsername', whoami.ensureAuthenticated, function (req, res) {
    whoami.updateUsername(req, res, req.param('username'));
});

app.get('/user/:id', function (req, res) {
	whoami.queryUser(req.params.id, res);
});

app.get('/users/:ids', function (req, res) {
	whoami.queryUsers(req.params.ids.split(','), res);
});

app.get('/dump/users', function (req, res) {
	whoami.queryDump(res);
});

server.listen(9191);
console.log('Listening on port 9191...');

var Driver = {
    init: function() {

    },
    inUsers: function (users, user) {
        for (var i = 0; i < users.length; i++) {
            if (users[i] == user)
                return i;
        }
        return -1;
    }
}
