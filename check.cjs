const fs = require('fs')
const path = require('path')

function walk(dir, results = []) {
  const list = fs.readdirSync(dir)
  for (const file of list) {
    const full = path.join(dir, file)
    const stat = fs.statSync(full)
    if (stat && stat.isDirectory()) walk(full, results)
    else if (full.endsWith('.jsx')) results.push(full)
  }
  return results
}

const files = walk('./src/pages')
const output = []
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  const hasMock = /mock|fake|TODO|const \w+ = \[\s*{/i.test(content) || /const [a-zA-Z0-9]+ = \{\s*[a-zA-Z0-9]+: \{/i.test(content)
  const hasFirestoreWrite = /addDoc|updateDoc|setDoc|deleteDoc/.test(content)
  const hasFirestoreRead = /onSnapshot|getDoc/.test(content)
  output.push({ name: path.basename(file), file, hasMock, hasFirestoreWrite, hasFirestoreRead })
}
console.log(JSON.stringify(output, null, 2))
