const fs = require('fs');
const path = require('path');

function getAllJsFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getAllJsFiles(fullPath));
    } else if (item.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function getAllCjsFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getAllCjsFiles(fullPath));
    } else if (item.endsWith('.cjs')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function updateRequireStatements(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  
  // Update relative imports without extensions to use .cjs
  content = content.replace(/require\(["'](\.\/?[^"']*?)["']\)/g, (match, importPath) => {
    // Skip if already has a file extension
    if (importPath.match(/\.[a-zA-Z]+$/)) {
      return match;
    }
    
    const fullImportPath = path.resolve(path.dirname(filePath), importPath);
    
    // Check if it's a directory with index file
    if (fs.existsSync(fullImportPath) && fs.statSync(fullImportPath).isDirectory()) {
      const indexPath = path.join(fullImportPath, 'index.cjs');
      if (fs.existsSync(indexPath)) {
        changed = true;
        return `require("${importPath}/index.cjs")`;
      }
    }
    
    // Check if the .cjs file exists
    const cjsPath = fullImportPath + '.cjs';
    if (fs.existsSync(cjsPath)) {
      changed = true;
      return `require("${importPath}.cjs")`;
    }
    
    return match;
  });
  
  if (changed) {
    fs.writeFileSync(filePath, content);
  }
}

// Main execution
const distDir = path.join(__dirname, '..', 'dist');

// First, rename all .js files to .cjs
const jsFiles = getAllJsFiles(distDir);
for (const jsFile of jsFiles) {
  const cjsFile = jsFile.replace(/\.js$/, '.cjs');
  fs.renameSync(jsFile, cjsFile);
  console.log(`Renamed ${path.relative(distDir, jsFile)} to ${path.relative(distDir, cjsFile)}`);
}

// Then, update all require statements in .cjs files
const cjsFiles = getAllCjsFiles(distDir);
for (const cjsFile of cjsFiles) {
  updateRequireStatements(cjsFile);
}

console.log('Post-build processing complete!');