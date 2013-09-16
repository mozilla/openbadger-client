const Api = require('./api');
const errors = require('./errors');
const _ = require('underscore');
const jwt = require('jwt-simple');
const async = require('async');

const TOKEN_LIFETIME = process.env['CSOL_OPENBADGER_TOKEN_LIFETIME'] || 10000;


function normalizeBadge (badge, id) {
  if (badge.shortname)
    badge.id = badge.shortname;

  if (!id)
    id = badge.shortname;

  if (!badge.id)
    badge.id = id;

  if (!badge.url)
    badge.url = '/earn/' + badge.id;

  return badge;
}

function normalizeBadgeInstance (badge, id) {
  /*  This is dumb, but let's us reuse current templates to
      build out a single-level object. */
  _.extend(badge, badge.badgeClass);

  if (!badge.id)
    badge.id = id;

  if (!badge.url)
    badge.url = '/mybadges/' + id;

  badge.id = id;

  return badge;
}

function normalizeProgram(program, id) {
  if (!id)
    id = program.shortname;

  if (!program.id)
    program.id = id;

  program.localUrl = '/explore/' + program.shortname;

  return program;
}

var categories = [
  {label: 'Science', value: 'science'},
  {label: 'Technology', value: 'technology'},
  {label: 'Engineering', value: 'engineering'},
  {label: 'Art', value: 'art'},
  {label: 'Math', value: 'math'}
];
var ageRanges = [
  {label: 'Under 13', value: '0-13'},
  {label: '13-18', value: '13-18'},
  {label: '19-24', value: '19-24'}
];
var activityTypes = [
  {label: 'Online', value: 'online'},
  {label: 'Offline', value: 'offline'}
];
var badgeTypes = [
  {label: 'Participation', value: 'participation'},
  {label: 'Skill', value: 'skill'},
  {label: 'Achievement', value: 'achievement'}
];
var orgs = [];

function updateOrgs (callback) {
  if (typeof callback !== 'function')
    callback = function () {};

  openbadger.getOrgs(function (err, data) {
    if (err)
      return callback(err);

    orgs = [];

    (data.orgs || data.issuers).forEach(function (org) {
      orgs.push({
        label: org.name,
        value: org.shortname
      });
    });

    orgs.sort(function(a, b) {
      var aVal = (a && a.label || '').toLowerCase().replace(/^\s*the\s+/, ''),
          bVal = (b && b.label || '').toLowerCase().replace(/^\s*the\s+/, '');

      return aVal.localeCompare(bVal);
    });

    callback(null, orgs);
  });
}

function confirmFilterValue (value, list) {
  if (!value && value !== 0)
    return null;

  for (var i = 0, l = list.length; i < l; ++i)
    if (list[i].value === value)
      return value;

  return null;
}

function applyFilter (data, query) {
  return _.filter(data, function(item) {
    return _.reduce(query, function(memo, value, field) {
      if (!memo) // We've already failed a test - no point in continuing
        return memo;

      if (!value && value !== 0)
        return memo;

      var data = item;

      if (field.indexOf('.') > -1) {
        var fieldParts = field.split('.').reverse();

        while (data && fieldParts.length > 1) {
          data = data[fieldParts.pop()];
        }

        field = fieldParts.reverse().join('.');
      }

      var itemValue = data ? data[field] : null;

      if (_.isArray(itemValue))
        return memo && _.contains(itemValue, value);

      return memo && (itemValue === value);
    }, true);
  })
}

function handleAutoAwards(email, learner, autoAwardedBadges) {
  if (autoAwardedBadges && autoAwardedBadges.length > 0) {
    async.map(autoAwardedBadges, function(shortname, cb) {
      openbadger.getUserBadge({ id: shortname, email: email }, cb);
    }, function(err, results) {
      if (err) {
        console.error('info', 'Failed to get user badges from openbadger for email %s', email);
        return;
      }

    });
  }
}

var openbadger = {
  getJWTToken: {
    func: function(email) {
      var claims = {
        prn: email,
        exp: Date.now() + TOKEN_LIFETIME
      };
      return jwt.encode(claims, self.OPENBADGER_SECRET);
    }.bind(this)
  },

  getBadges: {
    func: function getBadges (query, callback) {
      this.getAllBadges(query, callback);
    },
    paginate: true,
    key: 'badges'
  },

  getAllBadges: function getAllBadges (query, callback) {
    var category = confirmFilterValue(query.category, categories),
      ageGroup = confirmFilterValue(query.age, ageRanges),
      badgeType = confirmFilterValue(query.type, badgeTypes),
      activityType = confirmFilterValue(query.activity, activityTypes);

    this.get('/badges', {qs: {search: query.search, category: category, ageGroup: ageGroup, badgeType: badgeType, activityType: activityType }}, function(err, data) {
      if (err)
        return callback(err, data);

      return callback(null, {
        badges: _.map(data.badges, normalizeBadge)
      });
    })
  },

  getBadge: function getBadge (query, callback) {
    var id = query.id;

    if (!id)
      return callback(new errors.BadRequest('Invalid badge key'));

    this.get('/badge/' + id, function(err, data) {
      if (err)
        return callback(err, data);

      return callback(null, {
        badge: normalizeBadge(data.badge, id)
      });
    });
  },

  getPrograms: {
    func: function getPrograms (query, callback) {
      var qs = {
        category: query.category,
        org: query.org,
        age: query.age,
        activity: query.activity,
        search: query.search,
      };
      this.get('/programs', {qs: qs}, function(err, data) {
        if (err)
          return callback(err, data);

        return callback(null, {
          programs: _.map(data.programs, normalizeProgram)
        });
      });
    },
    paginate: true,
    key: 'programs'
  },

  getProgram: function getProgram (query, callback) {
    var id = query.id;

    if (!id)
      return callback(new errors.BadRequest('Invalid program key'));

    this.get('/program/' + id, function(err, data) {
      if (err)
        return callback(err, data);

      return callback(null, {
        program: normalizeProgram(data.program, id)
      });
    });
  },

  getOrgs: function getOrgs (query, callback) {
    this.get('/issuers/', function(err, data) {
      if (err)
        return callback(err, data);

      return callback(null, {
        orgs: _.values(data.issuers)
      });
    });
  },

  getUserBadges: {
    func: function getUserBadges (query, callback) {
      var email = query.email || query.session.user.email;
      var params = {
        auth: this.getJWTToken(email),
        email: email
      };
      this.get('/user', { qs: params }, function(err, data) {
        if (err)
          return callback(err, data);

        badges = _.map(data.badges, normalizeBadgeInstance)

        return callback(null, {
          badges: badges.sort(function(a, b) {
            return b.issuedOn - a.issuedOn;
          })
        });
      });
    }.bind(this),
    paginate: true,
    key: 'badges'
  },

  getUserBadge: function getUserBadge (query, callback) {
    var id = query.id;

    var email = query.email || query.session.user.email;
    var params = {
      auth: this.getJWTToken(email),
      email: email
    };

    this.get('/user/badge/' + id, { qs: params }, function(err, data) {
      if (err)
        return callback(err, data);

      return callback(null, {
        badge: normalizeBadgeInstance(data.badge, id)
      });
    });
  }.bind(this),

  awardBadge: function awardBadge (query, callback) {
    var email = query.learner ? query.learner.email : query.session.user.email;
    var shortname = query.badge;

    var params = {
      auth: this.getJWTToken(email),
      email: email
    };

    this.post('/user/badge/' + shortname, { form: params }, function(err, data) {
      if (err)
        return callback(err, data);

      handleAutoAwards(email, query.learner, data.autoAwardedBadges);

      return callback(null, {
        assertionUrl: data.url
      });
    });
  }.bind(this),

  getBadgeFromCode: function getBadgeFromCode (query, callback) {
    var email = query.email;
    var code = query.code;
    var params = {
      auth: this.getJWTToken(email),
      email: email,
      code: code,
    };
    this.get('/unclaimed', { qs: params }, function(err, data) {
      return callback(err, data);
    });
  }.bind(this),


  claim: function claim (query, callback) {
    var email = query.learner ? query.learner.email : null;
    var code = query.code;
    var params = {
      auth: this.getJWTToken(email),
      email: email,
      code: code,
    };
    this.post('/claim', { json: params }, function(err, data) {
      if (err)
        return callback(err);

      handleAutoAwards(email, query.learner, data.autoAwardedBadges);

      return callback(null, data);
    });
  }.bind(this),

  getBadgeRecommendations: function getBadgeRecommendations (query, callback) {
    var badgename = query.badgeName;
    var id = query.id;
    var limit = query.limit;
    var params = {
      limit: limit
    };

    if (badgename)
      id = badgename

    if (!id)
      return callback(new errors.BadRequest('Invalid badge key'));

    this.get('/badge/' + id + '/recommendations', { qs: params }, function(err, data) {
      if (err)
        return callback(err, data);

      return callback(null, {
        badges: _.map(data.badges, normalizeBadge)
      });
    });
  },

  getUserRecommendations: function getUserRecommendations (query, callback) {
    var user = query.session.user;
    var email = user.email;
    var params = {
      auth: this.getJWTToken(email),
      email: email
    };
    this.get('/user/recommendations', {qs: params}, function(err, data) {
      if (err)
        return callback(err, null);

      return callback(null, {
        recommendations: _.map(data.badges, normalizeBadge)
      });
    });
  }.bind(this)
};

updateOrgs();

module.exports = function(config) {
  openbadger.jwt_secret = config['OPENBADGER_SECRET'];
  var obr = new API(config['OPENBADGER_URL'], openbadger);
  return obr;
};

module.exports.getFilters = function getFilters () {
  return {
    categories: {
      name: 'category',
      label: 'Category',
      options: categories
    },
    ageRanges: {
      name: 'age',
      label: 'Age',
      options: ageRanges
    },
    orgs: {
      name: 'org',
      label: 'Organization',
      options: orgs
    },
    activityTypes: {
      name: 'activity',
      label: 'Activity',
      options: activityTypes
    },
    badgeTypes: {
      name: 'type',
      label: 'Type',
      options: badgeTypes
    },
    search: {
      name: 'search',
      label: 'Search'
    }
  };
}
module.exports.updateOrgs = updateOrgs;
