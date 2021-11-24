import path from 'path'
import _ from 'lodash'
import { Construct } from 'constructs'
import { Options, uid } from './utils'
import { zipDirectory } from './zipper'
import { packModules } from './modules'
import { webpackCompile } from './compiler'
import * as lambda from '@aws-cdk/aws-lambda'

interface LambdaWebpackProps extends Omit<lambda.FunctionProps, 'code'> {
  webpack: Options
}

export async function LambdaWebpack(scope: Construct, id: string, { webpack, ...props }: LambdaWebpackProps) {
  const zipId = uid()
  const config = require(webpack.webpackConfigPath)
  const buildPath = path.join(webpack.webpackOutputPath, id)
  
  const stat = await webpackCompile({
    ...config,
    entry: webpack.entry,
    output: {
      ...(config.output ||{}),
      path: buildPath,
      filename: '[name].js'
    }
  })
  
  await packModules(stat, id, webpack)
  await zipDirectory(stat.outputPath, webpack.webpackOutputPath, zipId)
  
  return new lambda.Function(scope, id, {
    ...props,
    code: lambda.Code.fromAsset(path.join(webpack.webpackOutputPath, `${zipId}.zip`))
  })
}