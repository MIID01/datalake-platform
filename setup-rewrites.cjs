const fs = require('fs');

// The list of function names parsed from firebase.js
const functionNames = [
  "submitcareerapplication", "createtask", "submithrscore", "createproject", 
  "assignengineertoproject", "getengineerprojectview", "submittimesheet", 
  "ctoapprovetimesheet", "clientsigntimesheet", "getmytimesheets", "getclienttimesheets", 
  "extractcvdata", "getrbacstate", "adduser", "updateuserrole", "disableuser", 
  "createcustomrole", "deletecustomrole", "uploadgrcdocument", "listgrcdocuments", 
  "downloadgrcdocument", "getgrcchangelog", "backfillemployee", "recordleaver", 
  "getbackfillconsentform", "submitbackfillconsent", "updateaccessmatrix", 
  "prepareinterviewcv", "sendinterviewcv", "getclientscorecardform", 
  "submitclientscorecard", "getcandidateinterviewsummary", "initiatehire", 
  "generatecontract", "dispatchcontractforsignature", "recordsignature", 
  "provisionengineer", "controllertimesheetvalidate", "controllerinvoicevalidate", 
  "auditorcontractreview", "getcontractreviews", "getcompliancereports", 
  "generateinvoice", "getinvoicedashboard", "generatezatcaxml", 
  "updatecandidatestage", "downloadcandidatecv", "managejoblisting"
];

// Generate rewrites
const rewrites = functionNames.map(name => ({
  source: `/api/${name}/**`,
  run: {
    serviceId: name,
    region: "me-central2"
  }
}));

// Add the catch-all for React Router at the very end
rewrites.push({
  source: "**",
  destination: "/index.html"
});

// Update firebase.json
const firebaseJson = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
firebaseJson.hosting.rewrites = rewrites;
fs.writeFileSync('firebase.json', JSON.stringify(firebaseJson, null, 2));

// Update src/lib/firebase.js
let firebaseJs = fs.readFileSync('src/lib/firebase.js', 'utf8');
firebaseJs = firebaseJs.replace(
  /const BASE = "https:\/\/\{name\}-808056940626\.me-central2\.run\.app";/,
  'const BASE = "/api/{name}";'
);
fs.writeFileSync('src/lib/firebase.js', firebaseJs);
console.log("Rewrites added and frontend URLs updated.");
