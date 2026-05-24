describe('Platform Navigation & Rendering', () => {
  it('Should load the landing page successfully', () => {
    cy.visit('/')
    // Basic check that the page isn't totally blank
    cy.get('body').should('be.visible')
  })

  // Note: True end-to-end testing with Firebase Auth in Cypress requires
  // programmatic login. For this first pass, we just ensure no page crashes completely on unauthenticated access (AuthGate should redirect).
  
  it('Should redirect unauthenticated users away from /employee to landing', () => {
    cy.visit('/employee')
    cy.url().should('eq', Cypress.config().baseUrl + '/')
  })
})
