const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth2').Strategy;
const fs = require('fs');

fs.readFile('credentials.json', 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading credentials file:', err);
    return;
  }

  try {
    const credentials = JSON.parse(data);

    if (!credentials.client_id || !credentials.client_secret) {
      console.error('Missing client_id or client_secret in credentials file');
      return;
    }

    const GOOGLE_CLIENT_ID = credentials.client_id;
    const GOOGLE_CLIENT_SECRET = credentials.client_secret;
  } catch (error) {
    console.error('Error parsing JSON in credentials file:', error);
  }
});

passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: "http://localhost:2210/auth/google/callback",
  passReqToCallback: true,
},
function(request, accessToken, refreshToken, profile, done) {
  return done(null, profile);
}));

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});