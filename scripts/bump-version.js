const fs = require('fs');
const path = require('path');
const execSync = require('child_process').execSync;

const root = process.cwd();
const vf = path.join(root, 'VERSION');
let v = '0.0037';
if (fs.existsSync(vf)) v = fs.readFileSync(vf, 'utf8').trim();

// parse numeric value
const num = parseFloat(v);
if (isNaN(num)) {
  console.error('Invalid VERSION file content:', v);
  process.exit(1);
}

// increment by 0.0001
const newNum = Math.round((num + 0.0001) * 10000) / 10000;
const newV = newNum.toFixed(4);
fs.writeFileSync(vf, newV + '\n', 'utf8');
console.log('Bumped version', v, '->', newV);

// update package.json version field as well (optional)
const pkgf = path.join(root, 'package.json');
if (fs.existsSync(pkgf)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgf, 'utf8'));
    pkg.version = newV;
    fs.writeFileSync(pkgf, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log('Updated package.json version to', newV);
  } catch (e) { console.warn('Failed updating package.json', e && e.message); }
}

// commit changes
try {
  execSync('git add VERSION package.json', { stdio: 'inherit' });
  execSync('git commit -m "chore(release): bump version to v-' + newV + '"', { stdio: 'inherit' });
  execSync('git push', { stdio: 'inherit' });
  console.log('Committed and pushed version bump');
} catch (e) {
  console.warn('Git commit/push failed (you may be in a detached head or without git):', e && e.message);
}
