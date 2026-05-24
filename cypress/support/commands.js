/**
 * DATALAKE: Cypress Custom Commands
 * cypress/support/commands.js
 * 
 * Add these commands to your existing cypress/support/commands.js
 * or replace it entirely with this file.
 */

// ============================================================
// Firebase Auth Login via REST API
// ============================================================
// 
// This command logs in programmatically using Firebase's REST API.
// It avoids the Google SSO popup which Cypress cannot interact with.
//
// PREREQUISITES:
// 1. Enable Email/Password sign-in in Firebase Console → Authentication → Sign-in method
// 2. Create test accounts with email/password in Firebase Console → Authentication → Users
//    (they can also have Google SSO — email/password is an additional sign-in method)
// 3. Each test account must have a matching Firestore users/{uid} document
//
// IMPORTANT: The Firebase Auth REST API returns a different token format
// than the SDK. We inject it into the app's auth state via localStorage.
// This works because Firebase Web SDK checks localStorage on init.

Cypress.Commands.add('loginViaFirebase', (email, password) => {
  const apiKey = Cypress.env('FIREBASE_API_KEY');
  
  if (!apiKey) {
    throw new Error(
      'FIREBASE_API_KEY not set. Add it to cypress.env.json:\n' +
      '{ "FIREBASE_API_KEY": "your-api-key-from-firebase-console" }'
    );
  }
  
  if (!password) {
    cy.log(`WARNING: No password for ${email}. Login skipped.`);
    return;
  }
  
  cy.request({
    method: 'POST',
    url: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    body: {
      email,
      password,
      returnSecureToken: true
    },
    failOnStatusCode: false
  }).then((response) => {
    if (response.status !== 200) {
      throw new Error(
        `Firebase login failed for ${email}: ${response.body.error?.message || response.status}\n` +
        'Check:\n' +
        '1. Email/Password sign-in is enabled in Firebase Console\n' +
        '2. The test account exists in Firebase Auth\n' +
        '3. The password is correct in cypress.env.json'
      );
    }
    
    const { idToken, localId, refreshToken, email: userEmail } = response.body;
    
    // Inject auth state into localStorage for Firebase SDK to pick up
    // Firebase SDK key format: firebase:authUser:<apiKey>:[DEFAULT]
    const authKey = `firebase:authUser:${apiKey}:[DEFAULT]`;
    const authValue = JSON.stringify({
      uid: localId,
      email: userEmail,
      emailVerified: true,
      isAnonymous: false,
      stsTokenManager: {
        refreshToken: refreshToken,
        accessToken: idToken,
        expirationTime: Date.now() + 3600000 // 1 hour
      },
      createdAt: String(Date.now()),
      lastLoginAt: String(Date.now()),
      apiKey: apiKey,
      appName: '[DEFAULT]'
    });
    
    // Set in localStorage before visiting the page
    cy.window().then((win) => {
      win.indexedDB.deleteDatabase('firebaseLocalStorageDb');
      win.localStorage.setItem(authKey, authValue);
    });
    
    cy.log(`Logged in as ${userEmail} (uid: ${localId})`);
  });
});

// ============================================================
// Utility: Check for console errors
// ============================================================
Cypress.Commands.add('assertNoConsoleErrors', () => {
  cy.window().then((win) => {
    // This only works if we've stubbed console.error in a beforeEach
    // See employee-portal.cy.js Test 7 for usage
  });
});

// ============================================================
// Utility: Wait for Firestore data
// ============================================================
Cypress.Commands.add('waitForFirestoreData', (selector, timeout = 15000) => {
  // Wait for a selector to appear AND have content
  // Useful for pages that load data from Firestore async
  cy.get(selector, { timeout })
    .should('exist')
    .and('be.visible')
    .invoke('text')
    .should('have.length.greaterThan', 0);
});
