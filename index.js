'use strict';

/**
 * serverless-mocha-plugin
 * - a plugin for TDD with serverless
 */

const path  = require('path'),
  fs        = require('fs'),
  lambdaWrapper = require('lambda-wrapper'),
  Mocha = require('mocha'),
  chai = require('chai'),
  Path = require('path'),
  ejs = require('ejs'),
  BbPromise = require('bluebird'); // Serverless uses Bluebird Promises and we recommend you do to because they provide more than your average Promise :)

const testFolder = 'test'; // Folder used my mocha for tests
const templateFilename = 'sls-mocha-plugin-template.ejs';

module.exports = function(S) { // Always pass in the ServerlessPlugin Class
  /**
   * Adding/Manipulating Serverless classes
   * - You can add or manipulate Serverless classes like this
   */

  S.classes.Project.newStaticMethod     = function() { console.log("A new method!"); };
  S.classes.Project.prototype.newMethod = function() { S.classes.Project.newStaticMethod(); };

  /**
   * Extending the Plugin Class
   * - Here is how you can add custom Actions and Hooks to Serverless.
   * - This class is only required if you want to add Actions and Hooks.
   */

  class PluginBoilerplate extends S.classes.Plugin {

    /**
     * Constructor
     * - Keep this and don't touch it unless you know what you're doing.
     */

    constructor() {
      super();
      this.name = 'io.sc5.mocha';
      this.testFileMap = {};
    }

    /**
     * Register Actions
     * - function mocha-create
     */

    registerActions() {

      S.addAction(this._createAction.bind(this), {
        handler:       '_createAction',
        description:   'Create mocha test for function',
        context:       'function',
        contextAction: 'mocha-create',
        options:       [{
          options:      'template',
          shortcut:     'T',
          description:  'name of a template file used when creating test'
        }],
        parameters: [ // Use paths when you multiple values need to be input (like an array).  Input looks like this: "serverless custom run module1/function1 module1/function2 module1/function3.  Serverless will automatically turn this into an array and attach it to evt.options within your plugin
          {
            parameter: 'paths',
            description: 'Path to function to test. If not defined, test all functions.',
            position: '0->' // Can be: 0, 0-2, 0->  This tells Serverless which params are which.  3-> Means that number and infinite values after it.
          }
        ]
      });

      S.addAction(this._runAction.bind(this), {
        handler:       '_runAction',
        description:   'Runs mocha test for function',
        context:       'function',
        contextAction: 'mocha-run',
        options:       [          {
            option:      'region',
            shortcut:    'r',
            description: 'region you want to run your function in'
          },
          {
            option:      'stage',
            shortcut:    's',
            description: 'stage you want to run your function in'
          },
          {
            option:      'reporter',
            shortcut:    'R',
            description: 'specify the reporter to use'
          },
          {
            option:      'reporter-options',
            shortcut:    'O',
            description: 'reporter-specific options'
          }],
        parameters: [ // Use paths when you multiple values need to be input (like an array).  Input looks like this: "serverless custom run module1/function1 module1/function2 module1/function3.  Serverless will automatically turn this into an array and attach it to evt.options within your plugin
          {
            parameter: 'paths',
            description: 'Path to function to test. If not defined, test all functions.',
            position: '0->' // Can be: 0, 0-2, 0->  This tells Serverless which params are which.  3-> Means that number and infinite values after it.
          }
        ]
      });

      return BbPromise.resolve();
    }

    /**
     * Register Hooks
     * -  function create (post) creates mocha test file
     */

    registerHooks() {
      S.addHook(this._hookPostFuncCreate.bind(this), {
        action: 'functionCreate',
        event:  'post'
      });

      return BbPromise.resolve();
    }

    /**
     * Custom action serverless function mocha-create functioName
     */

    _createAction(evt) {
      if (S.getProject().getFunction(evt.options.paths[0]) === undefined) {
        return new BbPromise(function(resolve, reject) {
          reject(`MochaPluginError: Function ${evt.options.paths[0]} does not exist in your project`);
        });
      }

      return createTest(evt.options.paths[0]);
    }

    _runAction(evt) {
      let _this = this;
      _this.evt = evt;
      _this.evt.options.stage = _this.evt.options.stage ? _this.evt.options.stage : null;

      return BbPromise.try(function() {
      })
        .bind(_this)
        .then(function() {
          return _this.cliPromptSelectStage('Choose a Stage: ', _this.evt.options.stage, false)
            .then(stage => {
              _this.evt.options.stage = stage;
            })
        })
        .then(function() {
          return _this.cliPromptSelectRegion('Choose a Region in this Stage: ', false, true, _this.evt.options.region, _this.evt.options.stage)
            .then(region => {
              _this.evt.options.region = region;
            })
        })
        .then(_this._runTests)
        .then(function() {
          return _this.evt;
        });
    }

    _runTests() {
      let _this = this;

      return new BbPromise(function(resolve, reject) {
        let functions = _this.evt.options.paths;
        let mocha = new Mocha({timeout: 5000});
        //This could pose as an issue if several functions share a common ENV name but different values.

        let stage = _this.evt.options.stage;
        let region = _this.evt.options.region;

        getFunctions(functions)
          .then(getFilePaths)
          .then(function(paths) {
            if (paths.length === 0) {
              return reject('No tests to run.');
            }
            paths.forEach(function(func) {
              SetEnvVars(func, {
                stage: stage,
                region: region
              });
              _this.testFileMap[funcNameFromPath(func.mochaPlugin.testPath)] = func;
              mocha.addFile(func.mochaPlugin.testPath);
            })
            var reporter = _this.evt.options.reporter;
            if ( reporter !== null) {
              var reporterOptions = {};
              if (_this.evt.options["reporter-options"] !== null) {
                _this.evt.options["reporter-options"].split(",").forEach(function(opt) {
                  var L = opt.split("=");
                  if (L.length > 2 || L.length === 0) {
                    throw new Error("invalid reporter option '" + opt + "'");
                  } else if (L.length === 2) {
                    reporterOptions[L[0]] = L[1];
                  } else {
                    reporterOptions[L[0]] = true;
                  }
                });
              }
              mocha.reporter(reporter, reporterOptions)
            }
            mocha.run(function(failures){
              process.on('exit', function () {
                process.exit(failures);  // exit with non-zero status if there were failures
              });
            })
              .on('suite', function(suite) {
                let funcName = funcNameFromPath(suite.file);

                let func = _this.testFileMap[funcName];

                if (func) {
                  SetEnvVars(func, {
                    stage: stage,
                    region: region
                  });
                }
              });
          }, function(error) {

            return reject(error);
          });
      });
    }

    /**
     * Hook for creating the mocha test placeholder after function creation
     */

    _hookPostFuncCreate(evt) {
      // TODO: only run with runtime node4.3
      if (evt.options.runtime != 'nodejs4.3') {
        return;
      }
      let parsedPath = path.parse(evt.options.path);
      let funcName = parsedPath.base;

      return createTest(funcName, templateFilename);
    }
  }

  //Set environment variables
  function SetEnvVars(func, config) {
    var envVars = func.toObjectPopulated(config).environment;
    var fields = Object.keys(envVars);

    for (var key in fields) {
      process.env[fields[key]] = envVars[fields[key]];
    }
    return process.env;
  }

  // Create the test folder
  function createTestFolder() {
      return new BbPromise(function(resolve, reject) {
        fs.exists(testFolder, function(exists) {
          if (exists) {
            return resolve(testFolder);
          }
          fs.mkdir(testFolder, function(err) {
            if (err) {
              return reject(err);
            }
            return resolve(testFolder);
          })
        })
      });
  }

  // Create the test file (and test folder)

  function createTest(funcName, templateFilename) {
    return createTestFolder().then(function(testFolder) {
      return new BbPromise(function(resolve, reject) {
        let funcFilePath = testFilePath(funcName);
        let projectPath = S.getProject().getRootPath();
        let funcFullPath = S.getProject().getFunction(funcName).getRootPath();
        let funcPath = path.relative(projectPath, funcFullPath).replace(/\\/g, "/");

        fs.exists(funcFilePath, function (exists) {
            if (exists) {
              return reject(new Error(`File ${funcFilePath} already exists`));
            }

          let templateFilenamePath = path.join(testFolder, templateFilename);
          fs.exists(templateFilenamePath, function (exists) {
            let templateString = exists ? getTemplateFromFile(templateFilenamePath) : getTemplateFromString();

              let content = ejs.render(templateString, {
                'functionName': funcName,
                'functionPath': funcPath
              });

              fs.writeFile(funcFilePath, content, function(err) {
                if (err) {
                  return reject(new Error(`Creating file ${funcFilePath} failed: ${err}`));
                }
                console.log(`serverless-mocha-plugin: created ${funcFilePath}`);
                return resolve(funcFilePath);
              })
            });
        });
      });
    });
  }

  // getFunctions. If no functions provided, returns all files
  function getFunctions(funcNames) {
    return new BbPromise(function(resolve, reject) {
      let funcObjs = [];
      if (funcNames.length === 0) {
        let sFuncs = S.getProject().getAllFunctions();

        return resolve(sFuncs);
      }

      let func;
      funcNames.forEach(function(funcName, idx) {
        func = S.getProject().getFunction(funcName);
        if (func) {
          funcObjs.push(func);
        } else {
          console.log(`Warning: Could not find function '${funcName}'.`);
        }
      });
      resolve(funcObjs);
    });
  }

  // getTestFiles. If no functions provided, returns all files
  function getFilePaths(funcs) {
    return new BbPromise(function(resolve, reject) {
        var paths = [];

        if (funcs && (funcs.length > 0)) {
            funcs.forEach(function(val, idx) {
              val.mochaPlugin = {
                testPath: testFilePath(val.name)
              };
              paths.push(val);
            });
            return resolve(paths);
        }
        return resolve([]);
    });
  }

  // Returns the path to a function's test file
  function testFilePath(funcName) {
      return path.join(testFolder, `${funcName.replace(/.*\//g, '')}.js`);
  }

  function funcNameFromPath(filePath) {
    let data = path.parse(filePath);

    return data.name
  }

  function getTemplateFromFile(templateFilenamePath) {
    return fs.readFileSync(templateFilenamePath, 'utf-8');
  }

  function getTemplateFromString() {
    return `'use strict';
// tests for <%= functionName %>
// Generated by serverless-mocha-plugin

const mod         = require('../<%= functionPath %>/handler.js');
const mochaPlugin = require('serverless-mocha-plugin');
const wrapper     = mochaPlugin.lambdaWrapper;
const expect      = mochaPlugin.chai.expect;

const liveFunction = {
  region: process.env.SERVERLESS_REGION,
  lambdaFunction: process.env.SERVERLESS_PROJECT + '-<%= functionName %>'
}

describe('<%= functionName %>', () => {
  before(function (done) {
//  wrapper.init(liveFunction); // Run the deployed lambda
    wrapper.init(mod);

    done()
  })

  it('implement tests here', (done) => {
    wrapper.run({}, (err, response) => {
      done('no tests implemented');
    });
  });
});
`;

  }
  // Export Plugin Class
  return PluginBoilerplate;
};

module.exports.lambdaWrapper = lambdaWrapper;
module.exports.chai = chai;