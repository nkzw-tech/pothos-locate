# `@nkzw/pothos-locate`

Enables GraphQL go-to-definition by mapping types and fields to Pothos source locations.

https://github.com/user-attachments/assets/e941950a-2944-4ab8-9954-17c6ad320347

## Installation

Install the [Relay VS Code extension](https://marketplace.visualstudio.com/items?itemName=meta.relay) for VS Code.

Then install the `@nkzw/pothos-locate` package:

```bash
npm install -D @nkzw/pothos-locate
```

Create a `pothos-locate` file in the root of your project, run `chmod +x pothos-locate`, and add the following code:

```bash
#!/bin/sh

node_modules/.bin/pothos-locate --src <path to your graphql definitions> "$@"
```

Now set the `relay.pathToLocateCommand` in your workspace settings to `./pothos-locate`.

_Note: We may be able to remove this intermediate file in the future, pending changes to the Relay VS Code extension._

## Usage

In VS Code you can `cmd+click` on a GraphQL type, field, interface, enum, or input object in your Relay GraphQL queries to jump directly to the Pothos implementation of the entity.

## Configuration

The package currently supports three configuration options:

- `--src` _(defaults to the project root)_: The source directory where your Pothos GraphQL definitions are located. It is recommended to set this to the directory closest to your GraphQL schema for improved performance.
- `--builder` _(defaults to `builder`)_: The local variable name used to define the GraphQL schema with Pothos. Your project must use the same binding name in every module.
- `--extensions` _(defaults to `ts,tsx`)_: The file extensions to search for Pothos definitions.

## Troubleshooting

You can call the script directly to see if it is working correctly. For example, if you have a `User` type with a `displayName` field you can run the following command:

```bash
./pothos-locate --src <path to your graphql definitions> --builder <your builder variable name> '<projectName>' User.displayName
```

and it should output the exact location:

```
/Users/cpojer/Projects/athena-crisis/artemis/graphql/nodes/User.tsx:120:4
```

_Note: The `<projectName>` is unused in this package but still passed by the Relay VS Code extension. You can use any string here._
