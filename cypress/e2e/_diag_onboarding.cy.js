// THROWAWAY diagnostic — reproduce the white-page on /employee/onboarding.
describe('diag: onboarding white page', () => {
  it('renders the onboarding content', () => {
    const errors = [];
    cy.on('uncaught:exception', (err) => {
      errors.push('UNCAUGHT: ' + err.message + '\n' + (err.stack || ''));
      return false;
    });

    cy.visit('/');
    cy.loginViaFirebase('mah.abdelghany@datalake.sa', 'Datalake2026!');
    cy.visit('/employee/onboarding');
    cy.wait(6000);

    cy.location('pathname').then((p) => {
      cy.document().then((doc) => {
        const root = doc.getElementById('root');
        const text = root ? root.innerText : '(no #root)';
        const len = root ? root.innerHTML.length : 0;
        throw new Error(
          `PATH=${p}\nROOT_LEN=${len}\nROOT_TEXT=${text.slice(0, 400)}\n` +
          `ERRORS(${errors.length}):\n${errors.join('\n---\n')}`
        );
      });
    });
  });
});
