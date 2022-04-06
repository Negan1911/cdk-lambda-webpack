import _ from 'lodash'
import path from 'path'
import BbPromise from 'bluebird'
import childProcess from 'child_process'
import builtinModules from 'builtin-modules'

const moduleSet = new Set(builtinModules);
const NODE_PROTOCOL = 'node:';

export type ExtModule = { origin: string; external: string }
export type ExtModules = { outputPath: string, externalModules: ExtModule[] }


export type NarrowOptions = {
  /**
   * The path to the webpack configuration file.
   */
  webpackConfigPath: string
}

export type Options = NarrowOptions & {
  /**
   * You can select the packager that will be used to package your external modules.
   * The packager can be set with the packager configuration.
   * Currently it can be 'npm' or 'yarn' and defaults to using npm when not set.
   */
  packager: 'npm' | 'yarn'
  
  /**
   * Common optional packager options regarding dependency resolution.
   */
  includeModules?: {
    /**
     * Relative path to custom `package.json` file, by default uses `package.json`.
     */
    packagePath?: string,
    /**
     * Sometimes it might happen that you use dynamic requires in your code, i.e. you
     * require modules that are only known at runtime. Webpack is not able to detect
     * such externals and the compiled package will miss the needed dependencies.
     * In such cases you can force the plugin to include certain modules by setting
     * them in the `forceInclude` array property. However the module must appear in
     * your service's production dependencies in `package.json`.
     */
    forceInclude?: string[],
    /**
     * You can forcefully exclude detected external modules, e.g. if you have a module
     * in your dependencies that is already installed at your provider's environment.
     * 
     * Just add them to the `forceExclude` array property and they will not be packaged.
     */
    forceExclude?: string[],

    /**
     * In some configuration (like monorepo), `node_modules` is in parent directory which is different from
     * where `package.json` is. Set `nodeModulesRelativeDir` to specify the relative directory where `node_modules` is.
     */
    nodeModulesRelativeDir?: string
  },
  /**
   * Different package options, depending if the packager is `npm` or `yarn`.
   */
  options?: {
    /**
     * Do not run `npm install` / `yarn install` (assume install completed).
     * Defaults to false, Available for both `npm` and `yarn`.
     */
    noInstall?: boolean,

    /**
     * Do not require an up-to-date yarn.lock
     * Defaults to false, Available only for `yarn`.
     */
    noFrozenLockfile?: boolean

    /**
     * Do not execute package.json hook scripts on install
     * Defaults to false, Available only for `yarn`.
     */
    ignoreScripts?: boolean

    /**
     * Specify number of concurrent network requests
     * Available only for `yarn`.
     */
    networkConcurrency?: number
  }
}

export function getEntry(entry: string, cwd: string): [string, string, string] {
  const entrySplit = entry.split(':')

  if (!entry.includes(':') || entrySplit.length !== 2)
    throw new Error(`Invalid entry: ${entry} does not conform the epected [path]:[export] format.`)

  return [
    path.isAbsolute(entrySplit[0]) ? entrySplit[0] : path.join(cwd, entrySplit[0]),
    entrySplit[0].replace(/\.[^/.]+$/, ''),
    entrySplit[1]
  ]
}

export function uid() {
  return (Math.round(Date.now())).toString(36)
}

export function ensureArray<T>(obj: T | T[]): T[] {
  return _.isArray(obj) ? obj : [obj];
}

export function splitLines(str?: string) {
  return _.split(str, /\r?\n/);
}

export function safeJsonParse(str: string) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

export class SpawnError extends Error {
  stdout: string;
  stderr: string;
  
  constructor(message: string, stdout: string, stderr: string) {
    super(message);
    this.stdout = stdout;
    this.stderr = stderr;
  }

  toString() {
    return `${this.message}\n${this.stderr}`;
  }
}

export function isBuiltinModule(moduleName: string) {
	if (typeof moduleName !== 'string') {
		throw new TypeError('Expected a string');
	}

	if (moduleName.startsWith(NODE_PROTOCOL)) {
		moduleName = moduleName.slice(NODE_PROTOCOL.length);
	}

	const slashIndex = moduleName.indexOf('/');
	if (slashIndex !== -1) {
		moduleName = moduleName.slice(0, slashIndex);
	}

	return moduleSet.has(moduleName);
};


/**
 * Executes a child process without limitations on stdout and stderr.
 * On error (exit code is not 0), it rejects with a SpawnProcessError that contains the stdout and stderr streams,
 * on success it returns the streams in an object.
 * @param  command - Command
 * @param {string[]} [args] - Arguments
 * @param {Object} [options] - Options for child_process.spawn
 */
export function spawnProcess(command: string, args: string[], options?: childProcess.SpawnOptionsWithoutStdio): Promise<{ stdout?: string; stderr?: string }> {
  return new BbPromise((resolve, reject) => {
    const child = childProcess.spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    // Configure stream encodings
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // Listen to stream events
    child.stdout.on('data', (data:string) => {
      stdout += data;
    });
    child.stderr.on('data', (data:string) => {
      stderr += data;
    });
    child.on('error', err => {
      reject(err);
    });
    child.on('close', exitCode => {
      if (exitCode !== 0) {
        reject(new SpawnError(`${command} ${_.join(args, ' ')} failed with code ${exitCode}`, stdout, stderr));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
