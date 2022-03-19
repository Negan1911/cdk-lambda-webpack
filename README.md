# CDK construct for AWS Lambda with Webpack

This construct will budle your resources with webpack and create separate assets so only the used dependencies are included.

## Example:

```ts
import * as cdk from "aws-cdk-lib/core";
import { LambdaWebpack } from "cdk-lambda-webpack";

/* For now, you need to use "async" stacks on the following way: */
export async function ExampleStack(
  scope: cdk.App,
  id: string,
  props?: cdk.StackProps
) {
  /* Instead of calling "super()", you create a stack instance */
  const stack = new cdk.Stack(scope, id, props);

  /* Use case is really similar to the lambda construct */
  const lambda = await LambdaWebpack(stack, `ExampleLambda`, {
    /* You can pass any option used by the Lambda construct, except 'code' */
    memorySize: 128,
    runtime: Runtime.NODEJS_14_X,
    functionName: `example-lambda`,
    timeout: cdk.Duration.seconds(25),
    environment: {
      NODE_ENV: "production",
    },
    /* Handle your point to your entry init file + : + the export holding code, on this case it's 'default' */
    handler: "./src/example.ts:default",
    /* Custom webpack config */
    webpack: {
      packager: "npm", // yarn or npm. Default is npm
      webpackConfigPath: "./webpack.config.js", // Points to the webpack config used to build the assets.
      includeModules: {
        forceExclude: ["aws-sdk"], // Force exclude "aws-sdk" module.
      },
      options: {}, // Other aditional options described below.
    },
  });
}
```

## LambdaWebpack Construct API.

All of the [Lambda construct parameters](https://docs.aws.amazon.com/cdk/api/latest/docs/aws-lambda-readme.html#handler-code) are available, **except code, for obvious reasons**.

We do have two reserved parameters, `handler` which their behaviour is diferent to the construct, and `webpack` which is a custom parameter of this library.

### Handler parameter.

In our library, `handler` is a string parameter, which defines the file entry point, plus the exported function to call, those are being separated by a colon (`:`).

Some use examples:

- Let's say that I want to use the default export of `src/example.js`, I will use `./src/example.js:default`.
- Let's say that I want to use the default export of `src/example.ts`, I will use `./src/example.ts:default`.
- Let's say that I want to use the named export "doRequest" of `src/example.ts`, I will use `./src/example.ts:doRequest`.

### Webpack parameter.

The `webpack` parameter declares configuration regarding how your assets are going to be built.

### Webpack config file path.

The `webpackConfigPath` parameter is the path to the webpack config file.

#### IncludeModules:

##### Monorepo config

In some configuration (like monorepo), `node_modules` is in parent directory which is different from
where `package.json` is. Set `nodeModulesRelativeDir` to specify the relative directory where `node_modules` is.

```ts
webpack: {
  includeModules: {
    nodeModulesRelativeDir: '../../' // relative path to current working directory.
  }
},
```

##### Forced inclusion

Sometimes it might happen that you use dynamic requires in your code, i.e. you
require modules that are only known at runtime. Webpack is not able to detect
such externals and the compiled package will miss the needed dependencies.
In such cases you can force the plugin to include certain modules by setting
them in the `forceInclude` array property. However the module must appear in
your service's production dependencies in `package.json`.

```ts
webpack: {
  includeModules: {
    forceInclude: ['module1', 'module2']
  }
},
```

##### Forced exclusion

You can forcefully exclude detected external modules, e.g. if you have a module
in your dependencies that is already installed at your provider's environment.

Just add them to the `forceExclude` array property and they will not be packaged.

```ts
webpack: {
  includeModules: {
    forceExclude: ['module1', 'module2']
  }
},
```

#### Packager and Options

Packager can be either `npm` or `yarn`, learn below to see which options are enabled for each case:

##### NPM

By default, the plugin uses NPM to package the external modules. However, if you use npm,
you should use any version `<5.5 >=5.7.1` as the versions in-between have some nasty bugs.

The NPM packager supports the following `packagerOptions`:

| Option    | Type | Default | Description                                         |
| --------- | ---- | ------- | --------------------------------------------------- |
| noInstall | bool | false   | Do not run `npm install` (assume install completed) |

##### Yarn

Using yarn will switch the whole packaging pipeline to use yarn, so does it use a `yarn.lock` file.

The yarn packager supports the following `packagerOptions`:

| Option             | Type | Default | Description                                          |
| ------------------ | ---- | ------- | ---------------------------------------------------- |
| ignoreScripts      | bool | false   | Do not execute package.json hook scripts on install  |
| noInstall          | bool | false   | Do not run `yarn install` (assume install completed) |
| noFrozenLockfile   | bool | false   | Do not require an up-to-date yarn.lock               |
| networkConcurrency | int  |         | Specify number of concurrent network requests        |

### Yarn2

There is an experimental Yarn2 packager, it's import is `LambdaWebpackYarn2`. It does not support additional config for now, usage:

```ts
import * as cdk from "aws-cdk-lib/core";
import { LambdaWebpack } from "cdk-lambda-webpack";

/* For now, you need to use "async" stacks on the following way: */
export async function ExampleStack(
  scope: cdk.App,
  id: string,
  props?: cdk.StackProps
) {
  /* Instead of calling "super()", you create a stack instance */
  const stack = new cdk.Stack(scope, id, props);

  /* Use case is really similar to the lambda construct */
  const lambda = await LambdaWebpack(stack, `ExampleLambda`, {
    /* You can pass any option used by the Lambda construct, except 'code' */
    memorySize: 128,
    runtime: Runtime.NODEJS_14_X,
    functionName: `example-lambda`,
    timeout: cdk.Duration.seconds(25),
    environment: {
      NODE_ENV: "production",
    },
    /* Handle your point to your entry init file + : + the export holding code, on this case it's 'default' */
    handler: "./src/example.ts:default",
    /* Custom webpack config */
    webpack: {
      webpackConfigPath: "./webpack.config.js", // Points to the webpack config used to build the assets.
    },
  });
}
```

It uses the internal API of yarn2 instead of using the command line, so anything that yarn2 supports, should be available.

As an added feature, it resolves workspace dependencies, so it should be safe to use in workspace environment (it can isolate a specific workspace and resolve their dependencies).

**Still, it's a experimental feature, so please report any issues you find.**

---

### Special Thanks:

All the people working at [Serverless Webpack](https://github.com/serverless-heaven/serverless-webpack). The logic for both Npm and Yarn1 are, mostly, extracted from there.

[Yarn focus command](https://github.com/yarnpkg/berry/blob/master/packages/plugin-workspace-tools/sources/commands/focus.ts) which was a great starting point for Yarn2+ support.
