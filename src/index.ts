#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from '@babel/parser';
import _traverse, {
  Node,
  NodePath,
  Scope,
  TraverseOptions,
} from '@babel/traverse';
import {
  ArgumentPlaceholder,
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  ObjectMethod,
  ObjectProperty,
  SpreadElement,
} from '@babel/types';
import { globSync } from 'glob';

type TraverseFn = (
  parent: Node,
  opts?: TraverseOptions,
  scope?: Scope,
  state?: unknown,
  parentPath?: NodePath,
) => void;

// `@babel/traverse` is messed up in an ESM context.
const traverse = ((_traverse as unknown as { default: typeof _traverse })
  .default || _traverse) as unknown as TraverseFn;

const root = process.cwd();
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    builderName: {
      type: 'string',
    },
    extensions: {
      default: 'ts,tsx',
      type: 'string',
    },
    'no-cache': {
      default: false,
      type: 'boolean',
    },
    src: {
      type: 'string',
    },
  },
});

const input = positionals[1];
const ignoreCache = !!values['no-cache'];
const extensions =
  values.extensions
    .trim()
    .split(',')
    .filter((extension) => !!extension?.length)
    .join(',') + ',';

const projectName = (() => {
  try {
    return (
      JSON.parse(
        readFileSync(join(root, 'package.json'), 'utf8'),
      )?.name?.replaceAll('/', '__') || 'unknown-pothos-locate-project'
    );
  } catch {
    /* empty */
  }

  return 'unknown-pothos-locate-project';
})();

const cacheFileName = (() => {
  const nodeModules = join(root, 'node_modules');
  const cacheDirectory = join(
    existsSync(nodeModules) ? join(nodeModules, '.cache') : tmpdir(),
    'pothos-locate',
  );

  mkdirSync(cacheDirectory, { recursive: true });
  return join(cacheDirectory, projectName);
})();

if (!input?.length) {
  console.error(
    `Please invoke the script by providing a GraphQL type as the second argument: 'pothos-locate <projectName> User.displayName'.`,
  );
  process.exit(1);
}

const sourceDirectory = values.src ? resolve(root, values.src) : root;
if (!existsSync(sourceDirectory)) {
  console.error(
    `Source directory '${sourceDirectory}' does not exist. Please provide a valid path via the '--src' option.`,
  );
  process.exit(1);
}

const builderName = values.builderName || 'builder';

type LocationData = Readonly<{
  column: number;
  fileName: string;
  line: number;
}>;

type LocationMap = Map<string, LocationData>;

const getFieldsExpression = (
  fields: ArrowFunctionExpression | ObjectMethod | ObjectProperty,
) => {
  const fn =
    fields.type === 'ArrowFunctionExpression'
      ? fields
      : fields.type === 'ObjectMethod'
        ? fields.key.type === 'Identifier'
          ? fields
          : null
        : fields.value;

  if (fn?.type === 'ArrowFunctionExpression') {
    if (fn.body.type === 'ObjectExpression') {
      return fn.body;
    } else if (fn.body.type === 'BlockStatement') {
      for (const statement of fn.body.body) {
        if (
          statement.type === 'ReturnStatement' &&
          statement.argument?.type === 'ObjectExpression'
        ) {
          return statement.argument;
        }
      }
    }
  }

  return null;
};

const extractLocations = (
  locationData: LocationMap,
  fileName: string,
  source: string,
) => {
  const ast = parse(source, {
    plugins: ['typescript', 'jsx'],
    sourceType: 'module',
  });

  const captureName = (
    name: ArgumentPlaceholder | SpreadElement | Expression,
    getName: (name: string) => string = (name) => name,
  ) => {
    const nodeName = name?.type === 'StringLiteral' ? name.value : null;
    if (nodeName && name.loc) {
      const { column, line } = name.loc.start;
      locationData.set(getName(nodeName), {
        column,
        fileName,
        line,
      });
    }
  };

  const captureProperties = (
    list: Array<ObjectMethod | ObjectProperty | SpreadElement> | undefined,
    getName: (name: string) => string = (name) => name,
  ) => {
    if (!list) {
      return;
    }

    for (const prop of list) {
      if (prop.type !== 'ObjectProperty') {
        continue;
      }
      const { key } = prop;
      const fieldName =
        key.type === 'Identifier'
          ? key.name
          : key.type === 'StringLiteral'
            ? key.value
            : null;

      if (fieldName && key.loc) {
        const { column, line } = key.loc.start;
        locationData.set(getName(fieldName), {
          column,
          fileName,
          line,
        });
      }
    }
  };

  const captureFields = (
    list: Array<ObjectMethod | ObjectProperty | SpreadElement>,
    getName: (name: string) => string = (name) => name,
  ) => {
    const fields = list.find(
      (prop) =>
        prop.type === 'ObjectProperty' &&
        ((prop.key.type === 'Identifier' && prop.key.name === 'fields') ||
          (prop.key.type === 'StringLiteral' && prop.key.value === 'fields')),
    );

    if (fields && fields.type !== 'SpreadElement') {
      captureProperties(getFieldsExpression(fields)?.properties, (fieldName) =>
        getName(fieldName),
      );
    }
  };

  traverse(ast, {
    CallExpression(path: NodePath<CallExpression>) {
      const { node } = path;
      const { callee } = node;

      if (
        callee.type !== 'MemberExpression' ||
        callee.object.type !== 'Identifier' ||
        callee.object.name !== builderName ||
        callee.property.type !== 'Identifier'
      ) {
        return;
      }

      if (callee.property.name === 'mutationField') {
        captureName(node.arguments[0], (name) => `Mutation.${name}`);
      } else if (callee.property.name === 'enumType') {
        const [maybeName, options] = node.arguments;
        if (maybeName?.type === 'StringLiteral') {
          captureName(maybeName);
        } else if (options?.type === 'ObjectExpression') {
          const name = options?.properties.find(
            (prop) =>
              prop.type === 'ObjectProperty' &&
              prop.key.type === 'Identifier' &&
              prop.key.name === 'name',
          );

          if (
            name?.type === 'ObjectProperty' &&
            name.value.type === 'StringLiteral'
          ) {
            captureName(name.value);
          }
        }
      } else if (
        callee.property.name === 'prismaNode' ||
        callee.property.name === 'inputType'
      ) {
        const [name, options] = node.arguments;
        const nodeName = name?.type === 'StringLiteral' ? name.value : null;
        captureName(name);
        if (callee.property.name === 'prismaNode') {
          captureName(name, (name) => `${name}.id`);
        }

        if (
          name?.type === 'StringLiteral' &&
          options?.type === 'ObjectExpression'
        ) {
          captureFields(
            options.properties,
            (fieldName) => `${nodeName}.${fieldName}`,
          );
        }
      } else if (callee.property.name === 'queryFields') {
        const [argument] = node.arguments;
        captureProperties(
          (argument?.type === 'ArrowFunctionExpression'
            ? getFieldsExpression(argument)
            : null
          )?.properties,
          (fieldName) => `Query.${fieldName}`,
        );
      } else if (callee.property.name === 'interfaceType') {
        const [ref, options] = node.arguments;

        if (
          !ref ||
          ref.type !== 'CallExpression' ||
          ref.callee.type !== 'MemberExpression' ||
          ref.callee.object.type !== 'Identifier' ||
          ref.callee.object.name !== builderName ||
          ref.callee.property.type !== 'Identifier' ||
          ref.callee.property.name !== 'interfaceRef'
        ) {
          return;
        }

        const [name] = ref.arguments;
        if (name?.type !== 'StringLiteral') {
          return;
        }

        captureName(name);
        if (options?.type === 'ObjectExpression') {
          captureFields(
            options.properties,
            (fieldName) => `${name.value}.${fieldName}`,
          );
        }
      }
    },
  });
};

const maybeGetCache = (): Readonly<{
  fileInfo: Map<string, number>;
  locationData: LocationMap;
}> => {
  if (!ignoreCache) {
    try {
      const cacheData = JSON.parse(readFileSync(cacheFileName, 'utf8'));
      return {
        fileInfo: new Map(cacheData.fileInfo),
        locationData: new Map(cacheData.locationData),
      };
    } catch {
      /* empty */
    }
  }

  return { fileInfo: new Map(), locationData: new Map() };
};

const { fileInfo, locationData } = maybeGetCache();

let hasChanges = false;
const files = new Map<string, number>();
for (const fileName of globSync(join(sourceDirectory, `**/*.{${extensions}}`), {
  absolute: true,
})) {
  const changed = statSync(fileName).mtimeMs;
  files.set(fileName, changed);

  if ((fileInfo.get(fileName) || 0) < changed) {
    hasChanges = true;
  }
}

if (hasChanges) {
  locationData.clear();

  for (const [fileName] of files) {
    extractLocations(locationData, fileName, readFileSync(fileName, 'utf8'));
  }
}

const info = locationData.get(input);
if (info) {
  console.log(`${info.fileName}:${info.line}:${info.column}`);
}

writeFileSync(
  cacheFileName,
  JSON.stringify({ fileInfo: [...files], locationData: [...locationData] }),
  'utf8',
);
