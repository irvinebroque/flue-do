import { readFile, writeFile } from 'node:fs/promises';

const userConfigPath = new URL('../wrangler.jsonc', import.meta.url);
const distConfigPath = new URL('../dist/wrangler.jsonc', import.meta.url);

const copiedKeys = ['artifacts', 'version_metadata', 'vars'];

const [userConfig, distConfig] = await Promise.all([
  readJson(userConfigPath),
  readJson(distConfigPath),
]);

for (const key of copiedKeys) {
  if (userConfig[key] !== undefined) distConfig[key] = userConfig[key];
}

await writeFile(distConfigPath, `${JSON.stringify(distConfig, null, 2)}\n`);

async function readJson(url) {
  return JSON.parse(stripJsonComments(await readFile(url, 'utf8')));
}

function stripJsonComments(input) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (inString) {
      output += char;
      const wasEscaped = escaped;
      escaped = char === '\\' ? !escaped : false;
      if (char === '"' && !wasEscaped) inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      output += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) {
        if (input[i] === '\n') output += '\n';
        i++;
      }
      i++;
      continue;
    }
    output += char;
  }
  return output;
}
