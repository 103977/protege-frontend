import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js'

const USER_POOL_ID = import.meta.env.VITE_COGNITO_POOL_ID as string
const APP_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string

const userPool = new CognitoUserPool({
  UserPoolId: USER_POOL_ID,
  ClientId: APP_CLIENT_ID,
})

export interface Tokens {
  idToken: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export function login(email: string, password: string): Promise<Tokens> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool })
    const authDetails = new AuthenticationDetails({ Username: email, Password: password })
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(sessionToTokens(session)),
      onFailure: (err) => reject(err),
    })
  })
}

export function logout(): void {
  const user = userPool.getCurrentUser()
  if (user) user.signOut()
}

export function refreshSession(): Promise<Tokens | null> {
  return new Promise((resolve) => {
    const user = userPool.getCurrentUser()
    if (!user) { resolve(null); return }
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) { resolve(null); return }
      resolve(sessionToTokens(session))
    })
  })
}

function sessionToTokens(session: CognitoUserSession): Tokens {
  const idToken = session.getIdToken()
  return {
    idToken: idToken.getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    expiresAt: idToken.getExpiration() * 1000,
  }
}
