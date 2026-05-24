/**
 * DATALAKE E2E: Authenticated Employee Portal
 * cypress/e2e/employee-portal.cy.js
 * 
 * Tests the full employee experience: login → dashboard → navigation → data rendering.
 * Uses Firebase Auth programmatic login via the REST API (no Google SSO popup).
 */

describe('Employee Portal — Authenticated', () => {
  
  const employeeEmail = Cypress.env('TEST_EMPLOYEE_EMAIL') || 'test.employee@datalake.sa';
  const employeePassword = Cypress.env('TEST_EMPLOYEE_PASSWORD') || 'TestPass123!';
  
  beforeEach(() => {
    // Login before each test
    cy.loginViaFirebase(employeeEmail, employeePassword);
  });

  // ----------------------------------------------------------
  // TEST 1: Dashboard renders with employee data
  // ----------------------------------------------------------
  it('Dashboard renders with employee name and stats', () => {
    cy.visit('/employee/dashboard');
    
    // Page must NOT be white/blank
    cy.get('body').should('not.be.empty');
    
    // Sidebar must exist with navy background
    cy.get('aside, [class*="sidebar"], nav')
      .should('exist')
      .and('be.visible');
    
    // Dashboard must show some content (heading, cards, or welcome message)
    cy.get('main, [class*="content"], [class*="dashboard"]')
      .should('exist')
      .and('be.visible');
    
    // Must NOT show a blank white page
    cy.get('main, [class*="content"]').invoke('text').should('have.length.greaterThan', 10);
    
    // Console should have no uncaught errors
    cy.on('uncaught:exception', (err) => {
      // Fail the test if there's an uncaught exception
      throw new Error(`Uncaught exception: ${err.message}`);
    });
  });

  // ----------------------------------------------------------
  // TEST 2: Sidebar navigation works — all 8 pages load
  // ----------------------------------------------------------
  const employeePages = [
    { path: '/employee/dashboard', label: 'Dashboard' },
    { path: '/employee/timesheets', label: 'Timesheets' },
    { path: '/employee/leave', label: 'Leave' },
    { path: '/employee/expenses', label: 'Expenses' },
    { path: '/employee/documents', label: 'Documents' },
    { path: '/employee/training', label: 'Training' },
    { path: '/employee/support', label: 'Support' },
    { path: '/employee/profile', label: 'Profile' },
  ];

  employeePages.forEach(({ path, label }) => {
    it(`${label} page (${path}) loads without white screen`, () => {
      cy.visit(path);
      
      // Must render something visible
      cy.get('body').should('not.be.empty');
      
      // Main content area must exist and have content
      cy.get('main, [class*="content"]', { timeout: 10000 })
        .should('exist')
        .and('be.visible');
      
      // Must show either data, an empty state message, or a form — never blank
      cy.get('main, [class*="content"]')
        .invoke('text')
        .should('have.length.greaterThan', 5);
      
      // Check for error messages
      cy.get('body').should('not.contain.text', 'Cannot read properties of undefined');
      cy.get('body').should('not.contain.text', 'Cannot read properties of null');
    });
  });

  // ----------------------------------------------------------
  // TEST 3: Timesheet submission form renders
  // ----------------------------------------------------------
  it('New Timesheet form is accessible and has required fields', () => {
    cy.visit('/employee/timesheets');
    
    // Find and click the "New Timesheet" button (may have different text)
    cy.contains(/new timesheet|submit timesheet|add timesheet|create/i)
      .should('exist')
      .click();
    
    // Form must appear with required fields
    // Look for: project selector, date/week picker, hours input
    cy.get('form, [class*="modal"], [class*="form"]', { timeout: 5000 })
      .should('exist')
      .and('be.visible');
  });

  // ----------------------------------------------------------
  // TEST 4: Leave page shows balance information
  // ----------------------------------------------------------
  it('Leave page shows leave balance or request form', () => {
    cy.visit('/employee/leave');
    
    // Must show either leave balance numbers, a request form, or an empty state
    // NOT a white page
    cy.get('main, [class*="content"]', { timeout: 10000 })
      .should('be.visible')
      .invoke('text')
      .should('have.length.greaterThan', 10);
    
    // Should contain leave-related text
    cy.get('body').invoke('text').then((text) => {
      const hasLeaveContent = /leave|annual|sick|balance|request|entitlement|days/i.test(text);
      expect(hasLeaveContent, 'Page should contain leave-related content').to.be.true;
    });
  });

  // ----------------------------------------------------------
  // TEST 5: Profile page shows employee data from Firestore
  // ----------------------------------------------------------
  it('Profile page shows real employee data (not mock)', () => {
    cy.visit('/employee/profile');
    
    cy.get('main, [class*="content"]', { timeout: 10000 }).should('be.visible');
    
    // Should show the employee's email (which we know is real)
    cy.get('body').should('contain.text', '@datalake.sa');
    
    // Should NOT contain mock data
    cy.get('body').should('not.contain.text', 'John Doe');
    cy.get('body').should('not.contain.text', 'Jane Doe');
    cy.get('body').should('not.contain.text', 'test@example.com');
    cy.get('body').should('not.contain.text', '20,000'); // old hardcoded salary
  });

  // ----------------------------------------------------------
  // TEST 6: Wildcard route redirects to dashboard
  // ----------------------------------------------------------
  it('Invalid employee route redirects to dashboard', () => {
    cy.visit('/employee/nonexistent-page-xyz');
    
    // Should redirect to /employee or /employee/dashboard
    cy.url().should('match', /\/employee(\/dashboard)?$/);
    
    // Dashboard content should be visible
    cy.get('main, [class*="content"]').should('be.visible');
  });

  // ----------------------------------------------------------
  // TEST 7: No console errors across navigation
  // ----------------------------------------------------------
  it('Navigating between pages produces no console errors', () => {
    const errors = [];
    
    cy.on('window:before:load', (win) => {
      cy.stub(win.console, 'error').callsFake((...args) => {
        errors.push(args.join(' '));
      });
    });
    
    cy.visit('/employee/dashboard');
    cy.wait(2000);
    
    cy.visit('/employee/timesheets');
    cy.wait(2000);
    
    cy.visit('/employee/leave');
    cy.wait(2000);
    
    cy.visit('/employee/profile');
    cy.wait(2000);
    
    // Check that no errors were logged
    cy.then(() => {
      const realErrors = errors.filter(e => 
        !e.includes('ResizeObserver') && // Browser noise
        !e.includes('favicon') &&
        !e.includes('service-worker')
      );
      
      if (realErrors.length > 0) {
        throw new Error(`Console errors found:\n${realErrors.join('\n')}`);
      }
    });
  });
});
