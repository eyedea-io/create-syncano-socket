#!/usr/bin/env node

const spawn = require('cross-spawn')
const chalk = require('chalk')
const path = require('path')
const fs = require('fs-extra')
const os = require('os')
const dns = require('dns')
const args = process.argv.slice(2)
const validateSocketName = require('validate-npm-package-name')

const errorLogFilePatterns = [
  'npm-debug.log',
  'yarn-error.log',
  'yarn-debug.log'
]

const socketDirectory = args[0]
const program = {
  name: function() {
    return 'yarn create syncano-socket'
  }
}

if (typeof socketDirectory === 'undefined') {
  console.error('Please specify the socket directory:')
  console.log(
    `  ${chalk.cyan(program.name())} ${chalk.green('<socket-directory>')}`
  )
  console.log()
  console.log('For example:')
  console.log(`  ${chalk.cyan(program.name())} ${chalk.green('my-socket')}`)
  console.log()
  process.exit(1)
}

createSocket(socketDirectory)

function createSocket(name) {
  const root = path.resolve(name)
  const socketName = path.basename(root)

  checkSocketName(socketName)
  fs.ensureDirSync(name)

  if (!isSafeToCreateProjectIn(root, name)) {
    process.exit(1)
  }

  console.log(`Creating a new Syncano Socket in ${chalk.green(root)}.`)
  console.log()

  const packageJson = {
    name: socketName,
    version: '0.1.0',
    private: true
  }

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(packageJson, null, 2) + os.EOL
  )

  const originalDirectory = process.cwd()
  process.chdir(root)

  run(root, socketName, originalDirectory)
}

function printValidationResults(results) {
  if (typeof results !== 'undefined') {
    results.forEach(error => {
      console.error(chalk.red(`  *  ${error}`))
    })
  }
}

function checkSocketName(socketName) {
  const validationResult = validateSocketName(socketName)

  if (!validationResult.validForNewPackages) {
    console.error(
      `Could not create a project called ${chalk.red(
        `"${socketName}"`
      )} because of npm naming restrictions:`
    )
    printValidationResults(validationResult.errors)
    printValidationResults(validationResult.warnings)
    process.exit(1)
  }
}

function isSafeToCreateProjectIn(root, name) {
  const validFiles = [
    '.DS_Store',
    'Thumbs.db',
    '.git',
    '.gitignore',
    '.idea',
    'README.md',
    'LICENSE',
    '.hg',
    '.hgignore',
    '.hgcheck',
    '.npmignore',
    'mkdocs.yml',
    'docs',
    '.travis.yml',
    '.gitlab-ci.yml',
    '.gitattributes'
  ]
  console.log()

  const conflicts = fs
    .readdirSync(root)
    .filter(file => !validFiles.includes(file))
    .filter(file => !/\.iml$/.test(file))
    // Don't treat log files from previous installation as conflicts
    .filter(
      file => !errorLogFilePatterns.some(pattern => file.indexOf(pattern) === 0)
    )

  if (conflicts.length > 0) {
    console.log(
      `The directory ${chalk.green(name)} contains files that could conflict:`
    )
    console.log()
    for (const file of conflicts) {
      console.log(`  ${file}`)
    }
    console.log()
    console.log(
      'Either try using a new directory name, or remove the files listed above.'
    )

    return false
  }

  // Remove any remnant files from a previous installation
  const currentFiles = fs.readdirSync(path.join(root))
  currentFiles.forEach(file => {
    errorLogFilePatterns.forEach(errorLogFilePattern => {
      // This will catch `(npm-debug|yarn-error|yarn-debug).log*` files
      if (file.indexOf(errorLogFilePattern) === 0) {
        fs.removeSync(path.join(root, file))
      }
    })
  })
  return true
}

function checkIfOnline() {
  return new Promise(resolve => {
    dns.lookup('registry.yarnpkg.com', err => {
      let proxy
      if (err != null && (proxy = getProxy())) {
        // If a proxy is defined, we likely can't resolve external hostnames.
        // Try to resolve the proxy name as an indication of a connection.
        dns.lookup(url.parse(proxy).hostname, proxyErr => {
          resolve(proxyErr == null)
        })
      } else {
        resolve(err == null)
      }
    })
  })
}

function install(root, dependencies, isOnline, isDev) {
  return new Promise((resolve, reject) => {
    let command = 'yarnpkg'
    let args = ['add', '--exact']

    if (!isOnline) {
      args.push('--offline')
    }
    ;[].push.apply(args, dependencies)

    args.push('--cwd')
    args.push(root)

    if (!isOnline) {
      console.log(chalk.yellow('You appear to be offline.'))
      console.log(chalk.yellow('Falling back to the local Yarn cache.'))
      console.log()
    }

    const child = spawn(command, args, {stdio: 'inherit'})
    child.on('close', code => {
      if (code !== 0) {
        reject({
          command: `${command} ${args.join(' ')}`
        })
        return
      }
      resolve()
    })
  })
}

function setCaretRangeForRuntimeDeps(packageName) {
  const packagePath = path.join(process.cwd(), 'package.json')
  const packageJson = require(packagePath)

  if (typeof packageJson.dependencies === 'undefined') {
    console.error(chalk.red('Missing dependencies in package.json'))
    process.exit(1)
  }

  const packageVersion = packageJson.dependencies[packageName]
  if (typeof packageVersion === 'undefined') {
    console.error(chalk.red(`Unable to find ${packageName} in package.json`))
    process.exit(1)
  }

  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + os.EOL)
}

function executeNodeScript({cwd, args}, data, source) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [...args, '-e', source, '--', JSON.stringify(data)],
      {cwd, stdio: 'inherit'}
    )

    child.on('close', code => {
      if (code !== 0) {
        reject({
          command: `node ${args.join(' ')}`
        })
        return
      }
      resolve()
    })
  })
}

function run(root, socketName, originalDirectory) {
  const packageName = '@eyedea/syncano'
  const allDependencies = [packageName]

  console.log('Installing packages. This might take a couple of minutes.')

  checkIfOnline()
    .then(isOnline => ({
      isOnline: isOnline,
      packageName: packageName
    }))
    .then(info => {
      const isOnline = info.isOnline
      const packageName = info.packageName

      console.log(`Installing ${chalk.cyan('@eyedea/syncano')}...`)
      console.log()

      return install(root, allDependencies, isOnline).then(() => packageName)
    })
    .then(async packageName => {
      setCaretRangeForRuntimeDeps(packageName)

      await executeNodeScript(
        {
          cwd: process.cwd(),
          args: []
        },
        [root, socketName, originalDirectory],
        `
        var init = require('${packageName}/scripts/init.js');
        init.apply(null, JSON.parse(process.argv[1]));
      `
      )
    })
    .catch(reason => {
      console.log()
      console.log('Aborting installation.')
      if (reason.command) {
        console.log(`  ${chalk.cyan(reason.command)} has failed.`)
      } else {
        console.log(chalk.red('Unexpected error. Please report it as a bug:'))
        console.log(reason)
      }
      console.log()

      // On 'exit' we will delete these files from target directory.
      const knownGeneratedFiles = ['package.json', 'yarn.lock', 'node_modules']
      const currentFiles = fs.readdirSync(path.join(root))
      currentFiles.forEach(file => {
        knownGeneratedFiles.forEach(fileToMatch => {
          // This removes all knownGeneratedFiles.
          if (file === fileToMatch) {
            console.log(`Deleting generated file... ${chalk.cyan(file)}`)
            fs.removeSync(path.join(root, file))
          }
        })
      })
      const remainingFiles = fs.readdirSync(path.join(root))
      if (!remainingFiles.length) {
        // Delete target folder if empty
        console.log(
          `Deleting ${chalk.cyan(`${appName}/`)} from ${chalk.cyan(
            path.resolve(root, '..')
          )}`
        )
        process.chdir(path.resolve(root, '..'))
        fs.removeSync(path.join(root))
      }
      console.log('Done.')
      process.exit(1)
    })
}
