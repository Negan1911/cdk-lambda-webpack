import fs from 'fs'
import path from 'path'
import archiver from 'archiver'


export function zipDirectory(inPath: string, outPath: string, fileName: string) {
  const output = fs.createWriteStream(path.join(outPath, `${fileName}.zip`))
  const archive = archiver('zip', { zlib: { level: 9 } })

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log(`Zip ${fileName}.zip created: ${archive.pointer()} bytes written.`)
      resolve(true)
    })

    archive.on('error', (err: any) => {
      console.log(`Error writting zip: .`)
      reject(err)
    })

    archive.pipe(output)
    archive.directory(inPath, false)
    archive.finalize()
  })
}