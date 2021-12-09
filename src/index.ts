import _ from 'lodash'
import path from 'path'
import { zipDirectory } from './zipper'
import { packModules } from './modules'
import { webpackCompile } from './compiler'
import * as lambda from '@aws-cdk/aws-lambda'
import { Stack, Construct } from '@aws-cdk/core'
import { Options, uid, getEntry, parseArgv } from './utils'

let lambdaSet = new Set<{
  id: string;
  entry: string;
  zipId: string;
  webpack: Options;
}>()

interface StackOptions {
  /**
   * If you need to do "cdk synth" 
   */
  skipCompile?: boolean
}

interface LambdaWebpackProps extends Omit<lambda.FunctionProps, 'code'> {
  webpack: Options
}

export async function LambdaWebpack(scope: Construct, id: string, { webpack, handler, ...props }: LambdaWebpackProps) {
  const zipId = uid()
  const [entry, exportName] = getEntry(handler)

  lambdaSet.add({
    ...props,
    id,
    zipId,
    entry,
    webpack,
  })
  
  return new lambda.Function(scope, id, {
    ...props,
    handler: `main.${exportName}`,
    code: lambda.Code.fromAsset(path.join(process.cwd(), '.build', `${zipId}.zip`))
  })
}

/**
 * 
 * @param stack - Stack holding the lambdas
 * @param options - Any extra options (skipCompile for now)
 * @returns Stack instance ready to use.
 */
export async function LambdaWebpackBuilder(stack: Stack, options: StackOptions = {}) {
  const argv_config = parseArgv()
  let skipCompile = options?.skipCompile ?? argv_config?.includes('deploy') ?? false

  lambdaSet = new Set()

  if (!skipCompile && lambdaSet.size > 0)
    await Promise.all(Array.from(lambdaSet).map(async lambda => {
      const config = require(path.isAbsolute(lambda.webpack.webpackConfigPath)
        ? lambda.webpack.webpackConfigPath
        : path.join(process.cwd(), lambda.webpack.webpackConfigPath)
      )
      
      const buildFolder = path.join(process.cwd(), '.build')
      const buildPath = path.join(buildFolder, lambda.id)
      
      const stat = await webpackCompile({
        ...config,
        entry: lambda.entry,
        output: {
          ...(config.output ||{}),
          path: buildPath,
          filename: '[name].js'
        }
      })
      
      await packModules(stat, lambda.id, lambda.webpack, buildPath)
      await zipDirectory(buildPath, buildFolder, lambda.zipId)
    }))

  return stack
}