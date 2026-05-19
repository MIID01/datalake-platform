const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'index.js');
let content = fs.readFileSync(indexPath, 'utf8');

// 1. Remove existing CORS OPTIONS blocks to avoid duplication
const optionsRegex = /^\s*if\s*\(\s*req\.method\s*===\s*["']OPTIONS["']\s*\)\s*\{[\s\S]*?return\s+res\.status\(204\)\.send\([^)]*\);\s*\}/gm;
content = content.replace(optionsRegex, '');

// 2. Inject the CORS headers at the start of every async (req, res) => { block
const targetRegex = /async\s*\(\s*req\s*,\s*res\s*\)\s*=>\s*\{/g;
const injection = `async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "https://datalake-production-sa.web.app");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }`;

content = content.replace(targetRegex, injection);

fs.writeFileSync(indexPath, content, 'utf8');
console.log('Fixed CORS in index.js');
