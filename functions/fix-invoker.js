const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'index.js');
let content = fs.readFileSync(indexPath, 'utf8');

// Replace "cors: ALLOWED_ORIGINS," with "cors: ALLOWED_ORIGINS, invoker: 'public',"
content = content.replace(/cors:\s*ALLOWED_ORIGINS\s*,/g, "cors: ALLOWED_ORIGINS,\n    invoker: 'public',");

fs.writeFileSync(indexPath, content, 'utf8');
console.log('Added invoker: "public" to all onRequest options.');
