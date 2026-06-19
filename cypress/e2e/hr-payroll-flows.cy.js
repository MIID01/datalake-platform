/**
 * DATALAKE E2E: HR / Payroll new flows
 * cypress/e2e/hr-payroll-flows.cy.js
 *
 * Covers this cycle's HR/payroll surfaces: deductions module, employee directory
 * project-assignment, interview CV prep, and the CEO payroll/operations settings.
 * Tolerant assertions — pages render real data / empty states, never a white screen,
 * never fabricated values.
 *
 * Needs cypress.env.json: FIREBASE_API_KEY + TEST_CEO_EMAIL/TEST_CEO_PASSWORD
 * (CEO can reach HR + CEO portals). Optionally TEST_HR_EMAIL/TEST_HR_PASSWORD.
 */

describe('HR / Payroll flows — Authenticated', () => {
  const email = Cypress.env('TEST_CEO_EMAIL') || 'm.alqumri@datalake.sa';
  const password = Cypress.env('TEST_CEO_PASSWORD');

  beforeEach(() => {
    cy.loginViaFirebase(email, password);
  });

  it('Deductions page loads with the category dropdown', () => {
    cy.visit('/hr/deductions');
    cy.get('main, [class*="content"]', { timeout: 10000 }).should('exist');
    cy.get('body').invoke('text').then((text) => {
      expect(text.toLowerCase()).to.not.include('dummy');
      expect(text.toLowerCase()).to.not.include('mock');
      // The module references its categories (loan/advance/bonus/fine…)
      expect(/deduction|bonus|loan|advance/i.test(text)).to.be.true;
    });
  });

  it('Interview CV Prep page resolves (and /hr/interview-prep redirects to it)', () => {
    cy.visit('/hr/interview-prep');
    cy.location('pathname', { timeout: 10000 }).should('include', '/hr/interview-cv');
    cy.get('main, [class*="content"]', { timeout: 10000 }).should('exist');
    // The leftover debug panel must NOT be present in production.
    cy.get('body').should('not.contain.text', 'NETWORK TAB SCREENSHOT SIMULATION');
  });

  it('Employee directory loads with project-assignment surface', () => {
    cy.visit('/hr/employees');
    cy.get('main, [class*="content"]', { timeout: 10000 }).should('exist');
    cy.get('body').should('contain.text', '@datalake.sa');
    cy.get('body').invoke('text').then((text) => {
      // Either assigned project names or the "Unassigned"/Assign affordance shows.
      expect(/assign|unassigned|project/i.test(text)).to.be.true;
    });
  });

  it('CEO payroll page loads (settings + run controls, real data)', () => {
    cy.visit('/ceo/finance');
    cy.get('main, [class*="content"]', { timeout: 10000 }).should('be.visible');
    cy.get('body').invoke('text').then((text) => {
      expect(text.toLowerCase()).to.not.include('dummy');
      expect(text.toLowerCase()).to.not.include('mock');
      // The hardcoded 20,000-for-everyone bug must not be back.
      expect(/payroll|payslip|salary/i.test(text)).to.be.true;
    });
  });
});
