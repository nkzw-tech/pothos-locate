import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

const root = process.cwd();
const fixtures = resolve(root, './src/__tests__/__fixtures__');

const run = (name: string) => {
  const result = execSync(
    `${join(import.meta.dirname, '../../lib/index.js')} --no-cache --extensions=fixture --src ${fixtures} x ${name}`,
  )
    .toString()
    .trim();

  if (!result.startsWith(root)) {
    throw new Error(`Expected result '${result}' to start with '${root}'.`);
  }

  return result.slice(root.length);
};

test('extracts Pothos definitions and allows queries', () => {
  expect(run('Map')).toMatchInlineSnapshot(
    `"/src/__tests__/__fixtures__/Map.fixture:11:31"`,
  );

  expect(run('Map.creator')).toMatchInlineSnapshot(
    `"/src/__tests__/__fixtures__/Map.fixture:23:4"`,
  );

  expect(run('MapSortBy')).toMatchInlineSnapshot(`"/src/__tests__/__fixtures__/Map.fixture:7:46"`);

  expect(run('Query.maps')).toMatchInlineSnapshot(`"/src/__tests__/__fixtures__/Map.fixture:30:2"`);
});
