import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';

const USER_POOL_ID = import.meta.env.VITE_COGNITO_POOL_ID;
const APP_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;

const userPool = new CognitoUserPool({
  UserPoolId: USER_POOL_ID,
  ClientId: APP_CLIENT_ID,
});

export function login(email, password) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(sessionToTokens(session)),
      onFailure: (err) => reject(err),
    });
  });
}

export function logout() {
  const user = userPool.getCurrentUser();
  if (user) user.signOut();
}

// Checks for a cached session and silently refreshes the ID token if needed.
// Resolves to null if there's no logged-in user or the refresh token is also dead.
export function refreshSession() {
  return new Promise((resolve) => {
    const user = userPool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }
    user.getSession((err, session) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(sessionToTokens(session));
    });
  });
}

function sessionToTokens(session) {
  const idToken = session.getIdToken();
  return {
    idToken: idToken.getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    expiresAt: idToken.getExpiration() * 1000, // ms epoch
  };
}