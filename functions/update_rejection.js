const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'index.js');
let code = fs.readFileSync(file, 'utf8');

// 1. CTO Rejection -> DRAFT
code = code.replace(
  'const newState = decision === "APPROVE" ? "CTO_APPROVED" : "REJECTED_BY_CTO";',
  'const newState = decision === "APPROVE" ? "CTO_APPROVED" : "DRAFT";'
);

// 2. Client Rejection -> DRAFT
code = code.replace(
  'const newState = decision === "SIGN" ? "CLIENT_SIGNED" : "REJECTED_BY_CLIENT";',
  'const newState = decision === "SIGN" ? "CLIENT_SIGNED" : "DRAFT";'
);

// 3. Delete client_sign_token on Client Rejection
code = code.replace(
  'rejection_reason: decision === "REJECT" ? rejection_reason : ts.rejection_reason,',
  'rejection_reason: decision === "REJECT" ? rejection_reason : ts.rejection_reason,\n        client_sign_token: decision === "REJECT" ? admin.firestore.FieldValue.delete() : ts.client_sign_token,'
);

fs.writeFileSync(file, code, 'utf8');
console.log('Rejection logic updated successfully.');
