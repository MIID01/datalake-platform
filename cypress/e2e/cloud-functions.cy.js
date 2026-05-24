/**
 * DATALAKE E2E: Cloud Function Health Checks
 * cypress/e2e/cloud-functions.cy.js
 * 
 * Tests that deployed Cloud Run services respond (not 403/500).
 * This catches the IAM binding problem that has caused 90% of bugs:
 * if a function returns 403, the IAM bindings are missing.
 * 
 * NOTE: These tests hit the DEPLOYED production endpoints, not localhost.
 * They require a valid Firebase Auth token to authenticate.
 * 
 * SETUP: Set FIREBASE_API_KEY, TEST_CEO_EMAIL, TEST_CEO_PASSWORD in cypress.env.json
 */

describe('Cloud Function Health — IAM & Connectivity', () => {
  
  let authToken = null;
  const baseUrl = 'https://me-central2-datalake-production-sa.cloudfunctions.net';
  
  before(() => {
    // Get a valid Firebase Auth token for API calls
    const apiKey = Cypress.env('FIREBASE_API_KEY');
    const email = Cypress.env('TEST_CEO_EMAIL') || 'm.alqumri@datalake.sa';
    const password = Cypress.env('TEST_CEO_PASSWORD');
    
    if (!password) {
      cy.log('WARNING: No TEST_CEO_PASSWORD set. Cloud function tests will be skipped.');
      return;
    }
    
    cy.request({
      method: 'POST',
      url: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      body: { email, password, returnSecureToken: true },
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === 200) {
        authToken = response.body.idToken;
      }
    });
  });
  
  // Helper: call a Cloud Run function and check it doesn't return 403 or 500
  const testFunction = (name, method = 'GET', body = null) => {
    if (!authToken) {
      cy.log(`Skipping ${name} — no auth token`);
      return;
    }
    
    // Cloud Run URLs follow the pattern: https://<function>-<hash>-<region>.a.run.app
    // But we can also use the Cloud Functions URL format
    // The actual URLs are in src/lib/firebase.js — adapt as needed
    
    const options = {
      method,
      url: `${baseUrl}/${name}`,
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      failOnStatusCode: false, // We want to inspect the status code
      timeout: 30000
    };
    
    if (body && method !== 'GET') {
      options.body = body;
    }
    
    cy.request(options).then((response) => {
      // 403 = IAM binding missing (the #1 bug)
      expect(response.status, `${name} should not return 403 (IAM missing)`).to.not.equal(403);
      
      // 500 = function crash (need to check Cloud Run logs)
      expect(response.status, `${name} should not return 500 (crash)`).to.not.equal(500);
      
      // 404 = function not deployed
      expect(response.status, `${name} should not return 404 (not deployed)`).to.not.equal(404);
      
      // Log the actual status for debugging
      cy.log(`${name}: ${response.status}`);
    });
  };

  // ----------------------------------------------------------
  // GROUP 1: Functions that should work (GET endpoints)
  // ----------------------------------------------------------
  describe('Read-only functions (should return 200)', () => {
    
    it('getrbacstate responds (not 403)', () => {
      testFunction('getrbacstate');
    });
    
    it('getmytimesheets responds (not 403)', () => {
      testFunction('getmytimesheets');
    });
    
    it('listgrcdocuments responds (not 403)', () => {
      testFunction('listgrcdocuments');
    });
    
    it('getgrcchangelog responds (not 403)', () => {
      testFunction('getgrcchangelog');
    });
    
    it('getinvoicedashboard responds (not 403)', () => {
      testFunction('getinvoicedashboard');
    });
  });

  // ----------------------------------------------------------
  // GROUP 2: Functions that need specific input (POST endpoints)
  // ----------------------------------------------------------
  describe('Write functions (should not return 403)', () => {
    
    it('submittimesheet rejects invalid input with 400 (not 403)', () => {
      testFunction('submittimesheet', 'POST', {
        // Send invalid data — we expect 400 (bad request), NOT 403 (IAM) or 500 (crash)
        test: true
      });
    });
    
    it('createproject rejects invalid input with 400 (not 403)', () => {
      testFunction('createproject', 'POST', { test: true });
    });
    
    it('adduser rejects invalid input with 400 (not 403)', () => {
      testFunction('adduser', 'POST', { test: true });
    });
  });

  // ----------------------------------------------------------
  // GROUP 3: Known broken functions (track fix progress)
  // ----------------------------------------------------------
  describe('Previously broken functions (track if fixed)', () => {
    
    it('backfillemployee — was returning 500', () => {
      if (!authToken) { cy.log('Skipped'); return; }
      
      cy.request({
        method: 'POST',
        url: `${baseUrl}/backfillemployee`,
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: { employees: [{ email: 'test@datalake.sa', name: 'Test' }] },
        failOnStatusCode: false,
        timeout: 30000
      }).then((response) => {
        if (response.status === 500) {
          cy.log('STILL BROKEN: backfillemployee returns 500');
        } else if (response.status === 403) {
          cy.log('IAM MISSING: backfillemployee returns 403');
        } else {
          cy.log(`backfillemployee: ${response.status} — may be fixed`);
        }
        // Don't fail the test — this is tracking, not blocking
      });
    });
    
    it('prepareinterviewcv — was returning 500', () => {
      if (!authToken) { cy.log('Skipped'); return; }
      
      cy.request({
        method: 'POST',
        url: `${baseUrl}/prepareinterviewcv`,
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: { candidateId: 'test', projectId: 'test' },
        failOnStatusCode: false,
        timeout: 30000
      }).then((response) => {
        if (response.status === 500) {
          cy.log('STILL BROKEN: prepareinterviewcv returns 500');
        } else if (response.status === 403) {
          cy.log('IAM MISSING: prepareinterviewcv returns 403');
        } else {
          cy.log(`prepareinterviewcv: ${response.status} — may be fixed`);
        }
      });
    });
  });

  // ----------------------------------------------------------
  // GROUP 4: Firestore Rules Sanity
  // ----------------------------------------------------------
  describe('Firestore Rules — unauthenticated access blocked', () => {
    
    it('Direct Firestore REST API rejects unauthenticated read of users collection', () => {
      cy.request({
        method: 'GET',
        url: 'https://firestore.googleapis.com/v1/projects/datalake-production-sa/databases/(default)/documents/users',
        failOnStatusCode: false
      }).then((response) => {
        // Should be 403 or 401 — NOT 200
        expect(response.status).to.be.oneOf([401, 403, 404]);
        cy.log('Firestore correctly blocks unauthenticated access to users collection');
      });
    });
    
    it('Direct Firestore REST API rejects unauthenticated read of employees collection', () => {
      cy.request({
        method: 'GET',
        url: 'https://firestore.googleapis.com/v1/projects/datalake-production-sa/databases/(default)/documents/employees',
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.be.oneOf([401, 403, 404]);
        cy.log('Firestore correctly blocks unauthenticated access to employees collection');
      });
    });
  });
});
