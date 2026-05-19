const admin = require("firebase-admin");
admin.initializeApp({ projectId: "datalake-production-sa" });
const { callOCR } = require("./lib/ai-client");

async function test() {
  const bucket = admin.storage().bucket("datalake-cv-uploads");
  const file = bucket.file("cvs/C-2026-7410/50fec988-5bab-413f-8845-502843fe1316-REEMA Almugheera CV.pdf.pdf (002).pdf");
  const [exists] = await file.exists();
  if (!exists) {
    console.log("File does not exist!");
    return;
  }
  const [buffer] = await file.download();
  console.log("Buffer length:", buffer.length);
  const ocrResult = await callOCR({
    fileBase64: buffer.toString("base64"),
    agent: "test",
    type: "test",
    triggeredBy: "test"
  });
  console.log("OCR Result Success:", ocrResult.success);
  console.log("OCR Result Pages:", ocrResult.pageCount);
  console.log("OCR Result Lines:", ocrResult.lines.length);
  console.log("First 5 lines:", ocrResult.lines.slice(0, 5));
}
test();
