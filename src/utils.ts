import _ from 'lodash'
import path from 'path'
import BbPromise from 'bluebird'
import childProcess from 'child_process'
import builtinModules from 'builtin-modules'

const moduleSet = new Set(builtinModules);
const NODE_PROTOCOL = 'node:';

export type ExtModule = { origin: string; external: string }
export type ExtModules = { outputPath: string, externalModules: ExtModule[] }

export type Options = {
  entry: string
  packager: 'npm' | 'yarn'
  webpackConfigPath: string
  includeModules?: {
    packagePath?: string,
    forceInclude?: string[],
    forceExclude?: string[],
    nodeModulesRelativeDir?: string
  },
  options?: {
    noInstall?: boolean,
    noFrozenLockfile?: boolean
    ignoreScripts?: boolean
    networkConcurrency?: number
  }
}

export function getEntry(entry: string): [string, string] {
  const entrySplit = entry.split(':')

  if (!entry.includes(':') || entrySplit.length !== 2)
    throw new Error(`Invalid entry: ${entry} does not conform the epected [path]:[export] format.`)

  return [
    path.isAbsolute(entrySplit[0]) ? entrySplit[0] : path.join(process.cwd(), entrySplit[0]),
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
