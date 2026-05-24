describe('Platform Sanity & Route Protection', () => {
  beforeEach(() => {
    // Clear cookies/storage before each test to ensure clean state
    cy.clearCookies()
    cy.clearLocalStorage()
  })

  it('1. Public Landing Page - Renders without crashing', () => {
    cy.visit('/')
    cy.get('body').should('be.visible')
    // Look for some text that should be on the landing page
    cy.contains(/datalake/i).should('exist')
  })

  it('2. Careers Page - Renders without crashing', () => {
    cy.visit('/careers')
    cy.get('body').should('be.visible')
  })

  it('3. Security: Unauthenticated access to /employee redirects to landing', () => {
    cy.visit('/employee')
    cy.url().should('eq', Cypress.config().baseUrl + '/')
  })

  it('4. Security: Unauthenticated access to /ceo redirects to landing', () => {
    cy.visit('/ceo')
    cy.url().should('eq', Cypress.config().baseUrl + '/')
  })

  it('5. Security: Unauthenticated access to /cto redirects to landing', () => {
    cy.visit('/cto')
    cy.url().should('eq', Cypress.config().baseUrl + '/')
  })

  it('6. Security: Unauthenticated access to /hr redirects to landing', () => {
    cy.visit('/hr')
    cy.url().should('eq', Cypress.config().baseUrl + '/')
  })

  it('7. Client Portal - Renders without crashing on fake token', () => {
    cy.visit('/client/timesheet/TEST_TOKEN_123', { failOnStatusCode: false })
    cy.get('body').should('be.visible')
    // Wait for any firebase lookups
    cy.wait(2000)
    // Even if it shows "Not Found", it should not white-screen
    cy.get('body').then($body => {
      const text = $body.text().toLowerCase()
      expect(text.length).to.be.greaterThan(0)
    })
  })

  it('8. Contract Acceptance - Renders without crashing on fake token', () => {
    cy.visit('/contract/TEST_TOKEN_123', { failOnStatusCode: false })
    cy.get('body').should('be.visible')
    cy.wait(2000)
    cy.get('body').then($body => {
      const text = $body.text().toLowerCase()
      expect(text.length).to.be.greaterThan(0)
    })
  })
})
